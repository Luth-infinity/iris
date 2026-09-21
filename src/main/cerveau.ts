import { app } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import { consigne, type EvenementTour, type Outil, type Tache } from '@shared/conversation'
import { PERMISSIONS, type Reglages } from '@shared/reglages'
import type { Modele } from './routeur'

/**
 * Le cerveau d'Iris est le Claude Code déjà installé sur la machine, appelé
 * en mode non interactif.
 *
 * C'est tout l'intérêt : l'abonnement paie déjà ces jetons, là où une clé
 * d'API les facturerait à l'appel. L'agent arrive avec ses outils (fichiers,
 * recherche, commandes), donc il n'y a aucun aiguillage d'intention à écrire —
 * c'est précisément ce qui avait coulé Nova.
 */


/**
 * La CLI répond « Not logged in · Please run /login », ce qui n'aide personne
 * dans une barre flottante : elle n'a pas de ligne de commande où taper quoi
 * que ce soit. Le Claude Code du terminal a sa propre connexion, distincte de
 * celle de l'application de bureau, et c'est celle-là qu'Iris utilise.
 */
const PAS_CONNECTE =
  'Claude Code n’est pas connecté. Dans un terminal : claude auth login, puis relancez Iris.'

function traduireErreur(brut: string): string {
  if (/not logged in|\/login|authentication_failed|unauthorized/i.test(brut)) return PAS_CONNECTE
  if (/usage limit|rate.?limit/i.test(brut)) {
    return 'Limite d’usage atteinte sur votre abonnement Claude.'
  }
  return brut
}

/**
 * Trouve l'exécutable de Claude Code.
 *
 * Sous Windows, `claude` est un `.cmd` qui ne fait qu'appeler `claude.exe`.
 * On lance l'exécutable directement : passer par le `.cmd` impose un
 * `cmd.exe`, qui ne met aucun argument entre guillemets. La consigne de départ
 * y était découpée mot par mot, et chacun de ses retours à la ligne terminait
 * la commande.
 *
 * On cherche des chemins explicites : une application lancée depuis
 * l'Explorateur n'a pas toujours le PATH complet de l'utilisateur.
 */
function commandeClaude(): { commande: string; shell: boolean } {
  if (process.platform === 'win32') {
    const candidats = [
      // Installation par npm (celle de cette machine).
      join(
        process.env.APPDATA ?? '',
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe'
      ),
      // Installation native.
      join(process.env.USERPROFILE ?? '', '.local', 'bin', 'claude.exe')
    ]
    const exe = candidats.find((c) => existsSync(c))
    if (exe) return { commande: exe, shell: false }
    // Dernier recours : le `.cmd`, dont les arguments sont alors protégés un
    // par un (voir `proteger`).
    return { commande: 'claude.cmd', shell: true }
  }
  return { commande: 'claude', shell: false }
}

/** Met un argument entre guillemets quand il doit traverser `cmd.exe`. */
function proteger(arg: string, shell: boolean): string {
  if (!shell) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

/**
 * Les dossiers usuels, sous le nom qu'on leur donne en parlant.
 *
 * Iris y a accès en plus du dossier de travail : c'est là qu'on lui demande de
 * déposer un fichier. Sans eux, « mets-le dans mes téléchargements » lui était
 * refusé. `app.getPath` suit les dossiers redirigés, par OneDrive notamment.
 */
export function dossiersUsuels(): { nom: string; chemin: string }[] {
  const liste: [string, Parameters<typeof app.getPath>[0]][] = [
    ['Téléchargements', 'downloads'],
    ['Bureau', 'desktop'],
    ['Documents', 'documents'],
    ['Images', 'pictures'],
    ['Musique', 'music'],
    ['Vidéos', 'videos']
  ]
  const dossiers: { nom: string; chemin: string }[] = []
  for (const [nom, cle] of liste) {
    try {
      dossiers.push({ nom, chemin: app.getPath(cle) })
    } catch {
      // Dossier inconnu du système : on s'en passe.
    }
  }
  return dossiers
}

/**
 * Outils qui ne se montrent pas comme une action : la liste de tâches a ses
 * propres bulles, et la recherche d'outils est de la cuisine interne.
 */
const INTERNES = new Set(['ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])

/** Le nom d'un fichier sans son chemin : c'est ce qu'on dit, pas le reste. */
function nomDeFichier(chemin: string): string {
  return chemin.split(/[\\/]/).filter(Boolean).pop() ?? chemin
}

/**
 * Ce qu'on affiche d'un appel d'outil : son nom, une phrase en français et une
 * ligne de contexte. La phrase est ce qu'on lit dans la bulle ; « Write » ou
 * « Bash » ne disent rien à qui ne connaît pas Claude Code.
 */
function decrireOutil(nom: string, entree: Record<string, unknown>): Outil {
  const champ = (cle: string): string => {
    const v = entree?.[cle]
    return typeof v === 'string' ? v : ''
  }
  const fichier = nomDeFichier(champ('file_path') || champ('notebook_path'))
  // L'agent décrit souvent lui-même sa commande (« Installer les
  // dépendances ») : c'est plus parlant que la commande elle-même.
  const description = champ('description')

  const libelle =
    nom === 'Write'
      ? `Écrit ${fichier}`
      : nom === 'Edit' || nom === 'MultiEdit' || nom === 'NotebookEdit'
        ? `Modifie ${fichier}`
        : nom === 'Read'
          ? `Lit ${fichier}`
          : nom === 'Bash' || nom === 'PowerShell'
            ? description || 'Lance une commande'
            : nom === 'Glob' || nom === 'Grep'
              ? 'Cherche dans les fichiers'
              : nom === 'WebSearch'
                ? `Cherche sur le web : ${champ('query')}`
                : nom === 'WebFetch'
                  ? 'Lit une page web'
                  : nom === 'Task' || nom === 'Agent'
                    ? description || 'Confie une partie à un sous-agent'
                    : nom

  const detail =
    champ('command') ||
    champ('file_path') ||
    champ('pattern') ||
    champ('query') ||
    description ||
    champ('url')
  // Un chemin complet déborde de la barre : on n'en garde que la fin.
  const court = detail.length > 90 ? '…' + detail.slice(-89) : detail
  return { nom, libelle, detail: court }
}

const STATUTS = new Set(['pending', 'in_progress', 'completed'])


// ─── Processus ───────────────────────────────────────────────────────────────

/**
 * Un Claude Code vivant, qui reçoit ses questions par l'entrée standard en
 * stream-json et reste ouvert entre deux tours.
 *
 * Lancer Claude Code coûte plusieurs secondes avant le premier mot. Un
 * processus déjà prêt répond en un peu plus d'une seconde, et une question de
 * suite dans le même processus en moins d'une (mesuré).
 */
type Processus = {
  enfant: ChildProcessWithoutNullStreams
  modele: Modele
  /** Empreinte des réglages au lancement : dossier, autorisations, garde. */
  cle: string
  session: string | null
  vivant: boolean
  /** Le tour en cours, qui reçoit les événements du flux. */
  tour: TourActif | null
  reste: string
  journal: string
}

type TourActif = {
  traiter: (ev: Record<string, unknown>) => void
  clore: (erreur?: string) => void
}

/** La conversation du sujet en cours. */
let courante: Processus | null = null
/** Session d'une conversation interrompue, pour la reprendre si on y revient. */
let derniereSession: string | null = null
/**
 * Processus lancés d'avance, sans conversation, un par modèle courant. Opus
 * n'en a pas : il sert aux gros chantiers, où deux secondes de démarrage ne se
 * remarquent pas, et un processus de plus en attente pèse en mémoire.
 */
const reserve = new Map<Modele, Processus>()
const EN_RESERVE: Modele[] = ['haiku', 'sonnet']

/** Le garde des actions irréversibles, s'il a pu démarrer (voir `garde.ts`). */
let garde: { port: number; jeton: string; commande: string } | null = null
let noter: (ligne: string) => void = () => {}

export function brancher(options: {
  garde: { port: number; jeton: string; commande: string } | null
  journal: (ligne: string) => void
}): void {
  garde = options.garde
  noter = options.journal
}

/** Chemin et contenu de la mémoire d'Iris, relus à chaque lancement. */
let memoire: () => { chemin: string; contenu: string } = () => ({ chemin: '', contenu: '' })
export function brancherMemoire(lire: () => { chemin: string; contenu: string }): void {
  memoire = lire
}

/**
 * Le mode d'autorisation réellement appliqué. « Tout » sans garde, ce serait
 * l'irréversible sans confirmation : on retombe alors sur l'écriture seule.
 */
function modeEffectif(reglages: Reglages): string {
  if (reglages.permission === 'total' && !garde) return PERMISSIONS.edition.mode
  return PERMISSIONS[reglages.permission].mode
}

function empreinte(reglages: Reglages): string {
  return [reglages.dossier, modeEffectif(reglages), garde?.port ?? ''].join('|')
}

/**
 * Les petits outils qu'Iris a le droit de lancer sans demander :
 * `iris-connecter.cmd` ouvre la connexion d'un compte (Figma surtout). Le
 * dossier est mis en tête du PATH de l'agent, et la commande autorisée seule.
 */
export const dossierOutils = app.isPackaged
  ? join(process.resourcesPath, 'assets', 'outils')
  : join(__dirname, '../../assets/outils')

/** Sous Windows la clé s'écrit souvent `Path` : un second `PATH` ne ferait qu'un doublon. */
function avecOutils(): Record<string, string> {
  const cle = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  return { [cle]: `${dossierOutils}${delimiter}${process.env[cle] ?? ''}` }
}

function tuer(p: Processus | null | undefined): void {
  if (!p || !p.vivant) return
  p.vivant = false
  // Tout l'arbre : l'agent lance ses propres processus (une commande, une
  // installation), et tuer le seul parent les laisserait tourner en silence.
  if (process.platform === 'win32' && p.enfant.pid) {
    spawn('taskkill', ['/pid', String(p.enfant.pid), '/t', '/f'], { windowsHide: true })
  } else {
    p.enfant.kill()
  }
}

function lancer(modele: Modele, reglages: Reglages, reprendre?: string): Processus {
  const { commande, shell } = commandeClaude()
  const dossier = reglages.dossier || process.env.USERPROFILE || process.cwd()
  const usuels = dossiersUsuels()
  const mem = memoire()
  const mode = modeEffectif(reglages)

  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    // `stream-json` exige `--verbose` : sans lui, la CLI refuse de démarrer.
    '--verbose',
    '--include-partial-messages',
    '--model',
    modele,
    '--permission-mode',
    mode,
    // En mode non interactif, personne ne répondrait à la demande
    // d'autorisation : la connexion d'un compte passerait à la trappe.
    '--allowedTools',
    'Bash(iris-connecter.cmd:*)',
    // Option à valeurs multiples : elle doit être suivie d'une autre option,
    // sinon elle avalerait ce qui vient après comme un dossier de plus.
    '--add-dir',
    dossier,
    ...usuels.map((d) => d.chemin),
    ...(mem.chemin ? [dirname(mem.chemin)] : []),
    // Toujours, y compris à la reprise : la consigne vit dans le processus,
    // pas dans la session. Une conversation reprise sans elle oubliait de
    // répondre court et de ne pas lire les chemins.
    '--append-system-prompt',
    consigne(dossier, usuels, mem)
  ]
  if (reprendre) args.push('--resume', reprendre)

  // Le garde intercepte les outils qui peuvent détruire ou publier, avant
  // qu'ils ne s'exécutent, et fait confirmer Lucas à la voix.
  if (garde && reglages.permission === 'total') {
    args.push(
      '--settings',
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit',
              hooks: [{ type: 'command', command: garde.commande, timeout: 120 }]
            }
          ]
        }
      })
    )
  }

  const enfant = spawn(commande, args.map((a) => proteger(a, shell)), {
    cwd: dossier,
    shell,
    windowsHide: true,
    env: {
      ...process.env,
      ...avecOutils(),
      ...(garde ? { IRIS_GARDE_PORT: String(garde.port), IRIS_GARDE_JETON: garde.jeton } : {}),
      // Le garde laisse Iris écrire sa mémoire sans rien demander.
      ...(mem.chemin ? { IRIS_MEMOIRE: dirname(mem.chemin) } : {})
    }
  }) as ChildProcessWithoutNullStreams

  const p: Processus = {
    enfant,
    modele,
    cle: empreinte(reglages),
    session: reprendre ?? null,
    vivant: true,
    tour: null,
    reste: '',
    journal: ''
  }

  enfant.stdout.setEncoding('utf-8')
  enfant.stdout.on('data', (morceau: string) => {
    // Le flux est du NDJSON : un objet par ligne, mais les morceaux tombent
    // au milieu des lignes.
    const lignes = (p.reste + morceau).split('\n')
    p.reste = lignes.pop() ?? ''
    for (const l of lignes) {
      if (!l.trim()) continue
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(l)
      } catch {
        // Ligne tronquée ou bruit de la CLI : on la laisse passer plutôt que
        // d'interrompre un tour qui se déroule bien.
        continue
      }
      if (typeof ev.session_id === 'string') p.session = ev.session_id
      p.tour?.traiter(ev)
    }
  })

  enfant.stderr.setEncoding('utf-8')
  enfant.stderr.on('data', (m: string) => {
    p.journal = (p.journal + m).slice(-400)
  })

  const fin = (erreur: string): void => {
    p.vivant = false
    if (courante === p) {
      derniereSession = p.session ?? derniereSession
      courante = null
    }
    for (const [m, r] of reserve) if (r === p) reserve.delete(m)
    p.tour?.clore(erreur)
  }
  enfant.on('error', (err) => fin('Impossible de lancer Claude Code : ' + err.message))
  enfant.on('close', (code) =>
    fin(
      p.journal.trim()
        ? traduireErreur(p.journal.trim())
        : `Claude Code s'est arrêté (code ${code}).`
    )
  )
  // Un processus de réserve peut attendre des heures : on évite qu'une
  // écriture dans un tube fermé ne remonte en exception non rattrapée.
  enfant.stdin.on('error', () => {})

  return p
}

/**
 * Remplit la réserve. Appelé au démarrage, après chaque changement de
 * réglages, et après chaque nouveau sujet (qui vient d'en consommer un).
 */
export function preparer(reglages: Reglages): void {
  const cle = empreinte(reglages)
  for (const modele of EN_RESERVE) {
    const p = reserve.get(modele)
    if (p?.vivant && p.cle === cle) continue
    tuer(p)
    reserve.set(modele, lancer(modele, reglages))
  }
}

export type Provenance = 'reserve' | 'reprise' | 'suite' | 'froid'

/**
 * Choisit le processus qui recevra la question.
 *
 * - suite du sujet, même modèle : la conversation vivante, sans rien relancer ;
 * - suite du sujet, autre modèle : on relance en reprenant la session ;
 * - nouveau sujet : un processus de la réserve, vierge.
 */
function choisirProcessus(
  reglages: Reglages,
  modele: Modele,
  suite: boolean
): { p: Processus; provenance: Provenance } {
  const cle = empreinte(reglages)

  if (
    suite &&
    courante?.vivant &&
    !courante.tour &&
    courante.modele === modele &&
    courante.cle === cle
  ) {
    return { p: courante, provenance: 'suite' }
  }

  const session = suite ? (courante?.session ?? derniereSession) : null
  tuer(courante)
  courante = null

  if (session) return { p: lancer(modele, reglages, session), provenance: 'reprise' }

  derniereSession = null
  const r = reserve.get(modele)
  reserve.delete(modele)
  if (r?.vivant && r.cle === cle) return { p: r, provenance: 'reserve' }
  tuer(r)
  return { p: lancer(modele, reglages), provenance: 'froid' }
}

/**
 * Pose une question à l'agent et pousse les événements au fur et à mesure.
 *
 * La promesse est tenue quand le tour est fini, et jamais rompue : l'appelant
 * est l'overlay, et une exception le laisserait figé sur « réflexion ».
 */
export function demander(
  question: string,
  reglages: Reglages,
  id: number,
  choix: { modele: Modele; suite: boolean },
  sur: (e: EvenementTour) => void
): Promise<void> {
  return new Promise((resolve) => {
    let choisi: { p: Processus; provenance: Provenance }
    try {
      choisi = choisirProcessus(reglages, choix.modele, choix.suite)
    } catch (err) {
      sur({ type: 'fin', id, texte: '', erreur: 'Claude Code introuvable : ' + String(err) })
      resolve()
      return
    }
    const { p, provenance } = choisi
    courante = p
    // La réserve vient de perdre un processus : on la refait, un peu plus
    // tard, pour ne pas disputer le processeur au tour qui démarre.
    if (provenance === 'reserve' || provenance === 'froid') {
      setTimeout(() => preparer(reglages), 2000)
    }

    const depart = Date.now()
    let premierMot = false
    sur({ type: 'debut', id })

    let texte = ''
    let close = false
    /** Les outils sont annoncés une fois : le flux répète les blocs partiels. */
    const vus = new Set<string>()
    /**
     * La liste de tâches de l'agent. `TaskCreate` ne connaît pas encore son
     * numéro : il arrive dans le résultat (« Task #2 created »), d'où l'attente
     * de l'appel à son résultat.
     */
    const creations = new Map<string, { titre: string; enCours: string }>()
    const taches = new Map<string, Tache>()
    const publierTaches = (): void => sur({ type: 'taches', id, taches: [...taches.values()] })

    const clore = (erreur?: string): void => {
      if (close) return
      close = true
      p.tour = null
      // Un processus tué pendant le tour (interruption) finit sans texte :
      // l'erreur n'est rapportée que si rien d'utile n'est venu avant.
      sur({ type: 'fin', id, texte: texte.trim(), erreur: texte.trim() ? undefined : erreur })
      resolve()
    }

    const traiter = (ev: Record<string, unknown>): void => {
      // Texte en direct. C'est ce qui permet de commencer à parler avant que
      // l'agent ait fini d'écrire.
      if (ev.type === 'stream_event') {
        const e = (ev.event ?? {}) as Record<string, unknown>
        const delta = (e.delta ?? {}) as Record<string, unknown>
        if (e.type === 'content_block_delta' && typeof delta.text === 'string') {
          if (!premierMot) {
            premierMot = true
            noter(`claude : ${p.modele}, ${provenance}, premier mot en ${Date.now() - depart} ms`)
          }
          texte += delta.text
          sur({ type: 'texte', id, delta: delta.text })
        }
        return
      }

      // Les appels d'outils n'apparaissent que sur le message complet.
      if (ev.type === 'assistant') {
        const message = (ev.message ?? {}) as Record<string, unknown>
        const blocs = Array.isArray(message.content) ? message.content : []
        for (const bloc of blocs as Record<string, unknown>[]) {
          if (bloc.type !== 'tool_use') continue
          const cle = String(bloc.id ?? bloc.name)
          if (vus.has(cle)) continue
          vus.add(cle)
          const nom = String(bloc.name ?? 'outil')
          const entree = (bloc.input ?? {}) as Record<string, unknown>
          const champ = (k: string): string =>
            typeof entree[k] === 'string' ? (entree[k] as string) : ''

          if (nom === 'TaskCreate') {
            const titre = champ('subject') || champ('description') || 'Tâche'
            creations.set(cle, { titre, enCours: champ('activeForm') || titre })
          } else if (nom === 'TaskUpdate') {
            const tache = taches.get(String(entree.taskId ?? ''))
            if (tache) {
              const statut = champ('status')
              if (statut === 'deleted') taches.delete(tache.id)
              else if (STATUTS.has(statut)) tache.statut = statut as Tache['statut']
              if (champ('subject')) tache.titre = champ('subject')
              if (champ('activeForm')) tache.enCours = champ('activeForm')
              publierTaches()
            }
          }

          if (!INTERNES.has(nom)) sur({ type: 'outil', id, outil: decrireOutil(nom, entree) })
        }
        return
      }

      // Les résultats d'outils reviennent dans un message « user » : c'est là
      // que la création d'une tâche révèle son numéro.
      if (ev.type === 'user') {
        const message = (ev.message ?? {}) as Record<string, unknown>
        const blocs = Array.isArray(message.content) ? message.content : []
        for (const bloc of blocs as Record<string, unknown>[]) {
          if (bloc.type !== 'tool_result') continue
          const creation = creations.get(String(bloc.tool_use_id))
          if (!creation) continue
          creations.delete(String(bloc.tool_use_id))
          const contenu =
            typeof bloc.content === 'string' ? bloc.content : JSON.stringify(bloc.content ?? '')
          const numero = contenu.match(/#(\d+)/)?.[1]
          if (!numero) continue
          taches.set(numero, { id: numero, ...creation, statut: 'pending' })
          publierTaches()
        }
        return
      }

      if (ev.type === 'result') {
        // Le texte final fait foi : les deltas peuvent manquer la fin si le
        // flux se coupe, et `result` porte aussi les erreurs d'authentification
        // (« Not logged in »), qui sinon passeraient pour une réponse.
        const resultat = typeof ev.result === 'string' ? ev.result : ''
        if (ev.is_error) {
          texte = ''
          clore(traduireErreur(resultat) || 'Claude Code a renvoyé une erreur.')
          return
        }
        if (resultat) texte = resultat
        clore()
      }
    }

    p.tour = { traiter, clore }

    // La question part par l'entrée standard, en stream-json : le processus
    // reste ouvert pour la suivante.
    p.enfant.stdin.write(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: question }] }
      }) + '\n'
    )
  })
}

/**
 * Coupe le tour en cours. La conversation est perdue avec son processus, mais
 * sa session est gardée : « en fait, continue » la reprend.
 */
export function interrompre(): void {
  if (!courante) return
  derniereSession = courante.session ?? derniereSession
  tuer(courante)
  courante = null
}

/** Repart d'une conversation vierge au prochain tour. */
export function oublier(): void {
  tuer(courante)
  courante = null
  derniereSession = null
}

/** Réglages changés : les processus d'avance ne correspondent plus. */
export function invalider(reglages: Reglages): void {
  for (const p of reserve.values()) tuer(p)
  reserve.clear()
  preparer(reglages)
}

/** À la fermeture d'Iris : plus aucun Claude Code ne doit lui survivre. */
export function fermerTout(): void {
  tuer(courante)
  courante = null
  for (const p of reserve.values()) tuer(p)
  reserve.clear()
}

export function enCours(): boolean {
  return !!courante?.tour
}

// ─── Comptes ─────────────────────────────────────────────────────────────────

/** Un serveur MCP à compte (Figma surtout), tel que le voit le Claude Code d'Iris. */
export type Compte = { nom: string; connecte: boolean }

/**
 * Les comptes Figma déclarés pour le dossier de travail.
 *
 * Un compte = un serveur (`figma-client-a`, `figma-client-b`…) : c'est ce qui les
 * garde cloisonnés. Ils sont déclarés pour un dossier précis, d'où la
 * commande lancée dans le dossier de travail d'Iris et pas ailleurs.
 */
export function listerComptes(reglages: Reglages): Promise<Compte[]> {
  const { commande, shell } = commandeClaude()
  const dossier = reglages.dossier || process.env.USERPROFILE || process.cwd()
  return new Promise((resolve) => {
    execFile(
      commande,
      ['mcp', 'list'],
      { cwd: dossier, shell, windowsHide: true, timeout: 45000 },
      (_err, sortie) => {
        const comptes: Compte[] = []
        for (const ligne of String(sortie ?? '').split(/\r?\n/)) {
          // `plugin:figma:figma` porte des deux-points : il ne passe pas, et
          // c'est voulu, il n'est rattaché à aucun compte choisi.
          const m = /^([\w.-]+): https?:\S+.* - (.+)$/.exec(ligne.trim())
          if (m && /figma/i.test(m[1])) comptes.push({ nom: m[1], connecte: /connected/i.test(m[2]) })
        }
        resolve(comptes)
      }
    )
  })
}

/**
 * Ouvre la connexion d'un compte dans sa propre fenêtre de terminal, la page
 * d'autorisation dans Firefox en navigation privée (`assets/outils`).
 */
export function connecterCompte(nom: string, reglages: Reglages): void {
  if (!/^[\w.-]+$/.test(nom)) return
  const dossier = reglages.dossier || process.env.USERPROFILE || process.cwd()
  spawn('cmd.exe', ['/c', join(dossierOutils, 'iris-connecter.cmd'), nom], {
    cwd: dossier,
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  }).unref()
}
