import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import http from 'http'

/**
 * Le garde des actions irréversibles.
 *
 * En mode « Tout », l'agent n'attend aucune autorisation : c'est ce qui lui
 * permet d'ouvrir une application ou d'installer un paquet sans rester bloqué
 * sur une question que personne ne peut entendre. Mais supprimer, écraser,
 * publier ou envoyer ne se rattrapent pas, et une transcription ratée suffit
 * à viser le mauvais dossier.
 *
 * Claude Code appelle donc `assets/garde.cjs` avant chaque commande et chaque
 * écriture (hook `PreToolUse`). Le script laisse passer ce qui est anodin, et
 * pour le reste interroge ce serveur local, qui fait confirmer Lucas à la voix
 * et rend oui ou non. Le serveur n'écoute que sur la boucle locale, et exige
 * un jeton tiré au hasard à chaque démarrage.
 */

export type Garde = { port: number; jeton: string; commande: string }

/**
 * Le hook tourne sous Node. On prend celui de la machine plutôt que de
 * relancer Electron en mode Node : la variable qu'il faut pour ça serait
 * héritée par les applications Electron que l'agent lance, qui démarreraient
 * alors comme de simples scripts.
 */
function trouverNode(): string | null {
  const windows = process.platform === 'win32'
  try {
    const sortie = execFileSync(windows ? 'where' : 'which', ['node'], {
      encoding: 'utf-8',
      windowsHide: true
    })
    return (
      sortie
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => (windows ? l.toLowerCase().endsWith('node.exe') : l.startsWith('/'))) ?? null
    )
  } catch {
    return null
  }
}

/**
 * Démarre le garde. Rend `null` s'il ne peut pas fonctionner (pas de Node, pas
 * de script) : le mode « Tout » retombe alors sur l'écriture seule, plutôt que
 * de laisser passer l'irréversible sans confirmation.
 */
export function demarrerGarde(
  script: string,
  confirmer: (action: string) => Promise<boolean>
): Promise<Garde | null> {
  const node = trouverNode()
  if (!node || !existsSync(script)) return Promise.resolve(null)

  const jeton = randomBytes(24).toString('hex')

  const serveur = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/confirmer' || req.headers['x-iris-jeton'] !== jeton) {
      res.writeHead(403).end()
      return
    }
    let corps = ''
    req.setEncoding('utf-8')
    req.on('data', (m: string) => {
      corps += m
      // Une demande de confirmation tient en une phrase.
      if (corps.length > 4000) req.destroy()
    })
    req.on('end', () => {
      let action = ''
      try {
        action = String(JSON.parse(corps)?.action ?? '').slice(0, 300)
      } catch {
        // Corps illisible : on refuse, sans rien demander.
      }
      const repondre = (ok: boolean): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok }))
      }
      if (!action) return repondre(false)
      confirmer(action).then(repondre, () => repondre(false))
    })
  })

  return new Promise((resolve) => {
    serveur.on('error', () => resolve(null))
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address()
      if (!adresse || typeof adresse === 'string') return resolve(null)
      // Barres obliques : la commande passe par l'interpréteur que Claude Code
      // choisit pour ses hooks, et les deux acceptent cette forme.
      const commande = `"${node.replace(/\\/g, '/')}" "${script.replace(/\\/g, '/')}"`
      resolve({ port: adresse.port, jeton, commande })
    })
  })
}
