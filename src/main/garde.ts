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

/**
 * Le serveur local d'Iris. `hook` est la commande à donner à Claude Code pour
 * le garde ; elle vaut `null` quand Node manque sur la machine — les questions,
 * elles, fonctionnent quand même.
 */
export type Garde = { port: number; jeton: string; hook: string | null }


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
  voix: {
    /** Une action irréversible attend un oui ou un non. */
    confirmer: (action: string) => Promise<boolean>
    /** Il manque une information à l'agent : Iris pose la question et écoute. */
    demander: (question: string) => Promise<string>
    /** L'agent est bloqué faute de droits : Iris demande l'autorisation. */
    autoriser: (raison: string) => Promise<boolean>
  }
): Promise<Garde | null> {
  const node = trouverNode()
  const jeton = randomBytes(24).toString('hex')

  const serveur = http.createServer((req, res) => {
    const routes = ['/confirmer', '/demander', '/autoriser']
    const route = routes.find((r) => r === req.url) ?? ''
    if (req.method !== 'POST' || !route || req.headers['x-iris-jeton'] !== jeton) {
      res.writeHead(403).end()
      return
    }
    let corps = ''
    req.setEncoding('utf-8')
    req.on('data', (m: string) => {
      corps += m
      // Une demande, comme une question, tient en une phrase.
      if (corps.length > 4000) req.destroy()
    })
    req.on('end', () => {
      const repondre = (charge: object): void => {
        // Le jeu de caractères est dit explicitement : sans lui, le client
        // PowerShell de Windows lit la réponse en latin-1 et les accents
        // reviennent à l'agent en charabia.
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(charge))
      }
      let texte = ''
      try {
        const recu = JSON.parse(corps)
        const brut =
          route === '/demander' ? recu?.question : route === '/autoriser' ? recu?.raison : recu?.action
        texte = String(brut ?? '').slice(0, 300)
      } catch {
        // Corps illisible : on refuse, sans rien demander à voix haute.
      }

      if (route === '/autoriser') {
        if (!texte) return repondre({ ok: false })
        voix.autoriser(texte).then(
          (ok) => repondre({ ok }),
          () => repondre({ ok: false })
        )
        return
      }

      if (route === '/demander') {
        if (!texte) return repondre({ reponse: '' })
        voix.demander(texte).then(
          (reponse) => repondre({ reponse }),
          () => repondre({ reponse: '' })
        )
        return
      }

      if (!texte) return repondre({ ok: false })
      voix.confirmer(texte).then(
        (ok) => repondre({ ok }),
        () => repondre({ ok: false })
      )
    })
  })

  return new Promise((resolve) => {
    serveur.on('error', () => resolve(null))
    serveur.listen(0, '127.0.0.1', () => {
      const adresse = serveur.address()
      if (!adresse || typeof adresse === 'string') return resolve(null)
      // Barres obliques : la commande passe par l'interpréteur que Claude Code
      // choisit pour ses hooks, et les deux acceptent cette forme. Sans Node
      // sur la machine, pas de garde — mais le serveur tourne, et les
      // questions passent.
      const hook =
        node && existsSync(script)
          ? `"${node.replace(/\\/g, '/')}" "${script.replace(/\\/g, '/')}"`
          : null
      resolve({ port: adresse.port, jeton, hook })
    })
  })
}
