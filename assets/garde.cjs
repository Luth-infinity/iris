// Garde d'Iris : hook PreToolUse de Claude Code.
//
// Claude Code l'appelle avant chaque commande et chaque écriture, avec l'appel
// d'outil en JSON sur l'entrée standard. Ce qui est anodin passe sans bruit
// (sortie vide, code 0). Ce qui est irréversible est soumis à Iris, qui fait
// confirmer Lucas à la voix ; la réponse revient à Claude Code sous forme de
// décision `allow` ou `deny`.
//
// Volontairement en JavaScript simple, sans dépendance : il tourne sous le
// Node de la machine, hors du paquet de l'application.

'use strict'

const fs = require('fs')
const http = require('http')
const path = require('path')

/** Commandes qui détruisent, publient, envoient ou touchent au système. */
const DANGERS = [
  { motif: /\b(rm|rmdir|rd|del|erase|Remove-Item|ri)\b/i, verbe: 'Supprimer' },
  { motif: /DeleteFile|DeleteDirectory|Clear-RecycleBin/i, verbe: 'Supprimer' },
  { motif: /\bgit\s+(clean|reset\s+--hard|checkout\s+--|restore\b|branch\s+-D|stash\s+(drop|clear))/i, verbe: 'Effacer des modifications' },
  { motif: /\bgit\s+push\b/i, verbe: 'Publier sur GitHub' },
  { motif: /\bgh\s+(release|repo\s+(delete|create)|pr\s+(merge|create))\b/i, verbe: 'Publier sur GitHub' },
  { motif: /\b(npm|pnpm|yarn)\s+publish\b/i, verbe: 'Publier un paquet' },
  { motif: /\bvercel\b[^|;&]*--prod\b/i, verbe: 'Mettre en ligne' },
  { motif: /\bSend-MailMessage\b/i, verbe: 'Envoyer un mail' },
  { motif: /\bClear-Content\b/i, verbe: 'Vider un fichier' },
  {
    motif: /\b(shutdown|Stop-Computer|Restart-Computer|Format-Volume|format\s+[a-z]:|diskpart|bcdedit|reg\s+delete|Remove-ItemProperty|Uninstall-Package|winget\s+uninstall)\b/i,
    verbe: 'Toucher au système'
  }
]

/** Le dernier élément d'un chemin, pour dire « le dossier cache » et pas tout le chemin. */
function nomCourt(chemin) {
  return String(chemin || '').split(/[\\/]/).filter(Boolean).pop() || ''
}

/** Est-ce que `cible` est dans `dossier` (ou en est un) ? */
function dedans(cible, dossier) {
  if (!cible || !dossier) return false
  const a = path.resolve(cible).toLowerCase()
  const b = path.resolve(dossier).toLowerCase()
  return a === b || a.startsWith(b + path.sep)
}

/**
 * Ce qu'il faut faire confirmer, en une phrase prononçable, ou `null` si
 * l'action peut passer sans rien demander.
 */
function aConfirmer(outil, entree, cwd) {
  if (outil === 'Bash' || outil === 'PowerShell') {
    const commande = String(entree.command || '')
    const danger = DANGERS.find((d) => d.motif.test(commande))
    if (!danger) return null
    // L'agent décrit presque toujours sa commande en français : c'est ce
    // qu'Iris dira. À défaut, le verbe et la dernière cible visible.
    const description = String(entree.description || '').trim()
    if (description) return description
    const cible = (commande.match(/["']?([A-Za-z]:[\\/][^"'\s;|&]+|[^\s"';|&]+\.[a-z0-9]{1,5})["']?\s*$/i) || [])[1]
    return cible ? `${danger.verbe} ${nomCourt(cible)}` : `${danger.verbe}, par une commande`
  }

  if (outil === 'Write') {
    // Écrire un nouveau fichier est anodin, réécrire un fichier de projet
    // aussi. Écraser un fichier existant hors des projets ne l'est pas.
    const fichier = String(entree.file_path || '')
    if (!fichier || !fs.existsSync(fichier)) return null
    if (dedans(fichier, cwd)) return null
    if (process.env.IRIS_MEMOIRE && dedans(fichier, process.env.IRIS_MEMOIRE)) return null
    return `Écraser le fichier ${nomCourt(fichier)}`
  }

  return null
}

/** Pose la question à Iris et attend la réponse de Lucas. */
function demander(action) {
  return new Promise((resolve) => {
    const port = Number(process.env.IRIS_GARDE_PORT)
    const jeton = process.env.IRIS_GARDE_JETON
    // Sans Iris pour demander, l'irréversible est refusé.
    if (!port || !jeton) return resolve(false)

    const corps = JSON.stringify({ action })
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/confirmer',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corps),
          'x-iris-jeton': jeton
        },
        // Un peu moins que le délai du hook : mieux vaut refuser proprement
        // que laisser Claude Code tuer le script.
        timeout: 110000
      },
      (res) => {
        let texte = ''
        res.setEncoding('utf8')
        res.on('data', (m) => (texte += m))
        res.on('end', () => {
          try {
            resolve(JSON.parse(texte).ok === true)
          } catch {
            resolve(false)
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end(corps)
  })
}

let entree = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (m) => (entree += m))
process.stdin.on('end', async () => {
  let ev
  try {
    ev = JSON.parse(entree)
  } catch {
    process.exit(0)
  }
  const action = aConfirmer(ev.tool_name, ev.tool_input || {}, ev.cwd)
  if (!action) process.exit(0)

  const ok = await demander(action)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: ok ? 'allow' : 'deny',
        permissionDecisionReason: ok
          ? 'Confirmé par Lucas à la voix.'
          : "Lucas a refusé cette action, ou n'a pas répondu. Ne la tente pas par un autre moyen ; dis-lui simplement que tu ne l'as pas faite."
      }
    })
  )
  process.exit(0)
})
