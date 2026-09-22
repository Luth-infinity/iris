import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'
import { FOURNISSEURS, REGLAGES_DEFAUT, normalizeReglages, type Reglages } from '../shared/reglages'
import {
  AVANT_RETRAIT,
  type Etat,
  type Memoire,
  type EvenementTour,
  type Forme,
  type ModeEcoute,
  type Tour
} from '../shared/conversation'
import * as cerveau from './cerveau'
import * as updates from './updates'
import { demarrerGarde } from './garde'
import { trier, type Modele } from './routeur'
import { Diseur, fermer as fermerVoix, synthetiser } from './voix'

// ─── Avant app.whenReady() ───────────────────────────────────────────────────
// Chromium bloque le micro hors HTTPS et pose sinon une demande d'accès que
// personne ne peut valider : la fenêtre de l'overlay n'a jamais le focus.
app.commandLine.appendSwitch('enable-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

// L'overlay passe sa vie masqué, et Windows déclare occluse toute fenêtre qui
// ne se voit pas : Chromium ralentit alors ses minuteurs puis gèle son
// renderer. Le réveil se paierait au moment précis où l'on attend la barre —
// et ici, aussi, pendant la lecture de la voix.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// Une application lancée depuis le Finder hérite d'un PATH minimal
// (/usr/bin:/bin…) : ni `claude`, ni `node`, ni `git` n'y sont. On reprend
// celui du shell de connexion, une fois, avant de lancer quoi que ce soit.
if (process.platform === 'darwin') {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const chemin = execFileSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf-8',
      timeout: 4000
    }).trim()
    const reperes = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
    process.env.PATH = [...new Set([...chemin.split(':'), ...reperes, ...(process.env.PATH ?? '').split(':')])]
      .filter(Boolean)
      .join(':')
  } catch {
    // Shell indisponible : les chemins explicites de `commandeClaude` restent.
  }
}

// Une seconde instance réenregistrerait le raccourci (échec silencieux) et
// poserait une deuxième icône dans la zone de notification.
if (!app.requestSingleInstanceLock()) app.exit(0)

// ─── Réglages ────────────────────────────────────────────────────────────────

const cheminReglages = join(app.getPath('userData'), 'reglages.json')

/**
 * Lu avant tout enregistrement : les trois fenêtres naissent masquées, donc un
 * tout premier lancement ne montre rien d'autre qu'une icône dans la zone de
 * notification, et l'application passe pour n'avoir pas démarré.
 */
const premierLancement = !fs.existsSync(cheminReglages)

/**
 * Au premier lancement, la clé de transcription est reprise de VoiceType si
 * elle y est : c'est le même compte Groq, sur la même machine, et la recopier
 * à la main est le genre de friction qui fait abandonner un premier essai.
 */
function heriterDeVoiceType(): string {
  for (const dossier of ['voice-type', 'VoiceType']) {
    try {
      const brut = fs.readFileSync(
        join(app.getPath('appData'), dossier, 'settings.json'),
        'utf-8'
      )
      const cle = JSON.parse(brut)?.apiKey
      if (typeof cle === 'string' && cle.startsWith('gsk_')) return cle
    } catch {
      // Application absente ou réglages illisibles : on continue sans.
    }
  }
  return ''
}

function chargerReglages(): Reglages {
  try {
    return normalizeReglages(JSON.parse(fs.readFileSync(cheminReglages, 'utf-8')))
  } catch {
    // Fichier absent au premier lancement, ou illisible : on repart des
    // défauts plutôt que d'empêcher le démarrage.
    return {
      ...REGLAGES_DEFAUT,
      cleApi: heriterDeVoiceType(),
      dossier: join(app.getPath('documents'), 'Apps')
    }
  }
}

function enregistrerReglages(r: Reglages): void {
  fs.writeFileSync(cheminReglages, JSON.stringify(r, null, 2))
}

// ─── État ────────────────────────────────────────────────────────────────────

let overlay: BrowserWindow | null = null
let conversation: BrowserWindow | null = null
let parametres: BrowserWindow | null = null
let bienvenue: BrowserWindow | null = null
let tray: Tray | null = null
let reglages = chargerReglages()
let etat: Etat = 'repos'
let quitte = false
/** Résolue quand l'overlay a fini de charger : un `send` avant serait perdu. */
let overlayPret: Promise<void> = Promise.resolve()
/** Le fil complet, gardé ici : la fenêtre de conversation peut s'ouvrir tard. */
const tours: Tour[] = []
let prochainId = 1
let diseur: Diseur | null = null
/** Minuterie de repli de l'overlay, annulée si un tour reprend entre-temps. */
let replier: NodeJS.Timeout | null = null
let forme: Forme = 'barre'
/** Minuterie du retrait sur le côté, quand la réponse se fait attendre. */
let retrait: NodeJS.Timeout | null = null
/** Posée d'un clic sur la pastille : Iris reste en face jusqu'à la fin du tour. */
let epingle = false
/**
 * L'agent n'a pas fini son tour. Iris peut avoir fini une phrase (« Je m'en
 * occupe ») et continuer de travailler : la fin de la lecture ne veut alors
 * pas dire la fin de la réponse.
 */
let tourEnCours = false

/** La dernière écoute a été ouverte juste après une réponse d'Iris. */
let ecouteEnSuite = false
/** Le dernier échange abouti, pour que le tri juge si la suivante le continue. */
let precedent: { question: string; reponse: string; fin: number } | null = null
/**
 * Le modèle du sujet en cours. Une demande qui continue un sujet ne redescend
 * pas d'un cran : « tu peux le tester ? » après un travail sur Sonnet partait
 * sur Haiku, qui reprenait la conversation sans savoir la mener.
 */
let modeleCourant: Modele | null = null

/**
 * Une action irréversible attend le oui de Lucas (voir `garde.ts`). Une seule à
 * la fois : l'agent est suspendu tant qu'elle n'est pas tranchée.
 */
let confirmation: {
  action: string
  /** La question a été envoyée à la lecture : la fin de lecture ouvre le micro. */
  audioEnvoye: boolean
  resoudre: (ok: boolean) => void
} | null = null

/**
 * L'agent a besoin d'une précision et s'est arrêté pour la demander. La
 * réponse est sa phrase, telle qu'elle a été dite : c'est le seul moment où
 * ce qu'on dit ne part pas à un nouveau tour.
 */
let question: {
  texte: string
  /** `autorisation` attend un oui ou un non, et un bouton s'affiche. */
  genre: 'precision' | 'autorisation'
  audioEnvoye: boolean
  resoudre: (reponse: string) => void
} | null = null

const assetsDir = app.isPackaged
  ? join(process.resourcesPath, 'assets')
  : join(__dirname, '../../assets')

const iconApp = join(assetsDir, 'icon.ico')

// ─── Diffusion ───────────────────────────────────────────────────────────────

function diffuser(canal: string, ...args: unknown[]): void {
  for (const fenetre of [overlay, conversation]) {
    if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(canal, ...args)
  }
}

// ─── Journal ─────────────────────────────────────────────────────────────────

/**
 * Trace des états et des événements, dans `%APPDATA%/iris/journal.log`.
 *
 * Un assistant vocal se déroule dans le temps, à travers trois process et un
 * micro : quand « elle ne répond plus », seul l'enchaînement exact dit où la
 * chaîne s'est arrêtée. Les deux cents dernières lignes suffisent.
 */
const cheminJournal = join(app.getPath('userData'), 'journal.log')
const LIGNES_JOURNAL = 200

/** Lignes ajoutées depuis le dernier élagage du fichier. */
let ajouts = 0
/** L'échec d'écriture n'est signalé qu'une fois : il se répéterait à chaque ligne. */
let echecSignale = false

function noter(ligne: string): void {
  const entree = `${new Date().toISOString().slice(11, 23)}  ${ligne}`
  // Aussi dans le terminal qui a lancé Iris : quand le fichier reste muet
  // (c'est arrivé sans qu'on sache pourquoi), c'est la seule trace qui reste.
  console.log(`[iris] ${entree}`)
  try {
    // Ajout en fin de fichier plutôt que réécriture complète : rien à relire,
    // et une écriture interrompue ne vide plus le journal.
    fs.appendFileSync(cheminJournal, entree + '\r\n')
    if (++ajouts >= 50) {
      ajouts = 0
      const lignes = fs.readFileSync(cheminJournal, 'utf-8').split(/\r?\n/).filter(Boolean)
      if (lignes.length > LIGNES_JOURNAL) {
        fs.writeFileSync(cheminJournal, lignes.slice(-LIGNES_JOURNAL).join('\r\n') + '\r\n')
      }
    }
  } catch (err) {
    if (!echecSignale) {
      echecSignale = true
      console.error(`[iris] journal impossible à écrire (${cheminJournal}) :`, err)
    }
  }
}

// Une erreur non rattrapée dans le process principal fermait Iris sans rien
// dire. On la consigne, et Iris reste debout.
process.on('uncaughtException', (err) => {
  noter(`ERREUR non rattrapée : ${err?.stack ?? String(err)}`.slice(0, 1500))
})
process.on('unhandledRejection', (raison) => {
  noter(`ERREUR de promesse : ${raison instanceof Error ? raison.stack : String(raison)}`.slice(0, 1500))
})

function poserEtat(suivant: Etat): void {
  if (etat === suivant) return
  noter(`état ${etat} → ${suivant}`)
  etat = suivant
  diffuser('etat', suivant)
  rafraichirTray()
}

// ─── Fenêtres ────────────────────────────────────────────────────────────────

function chargerPage(
  win: BrowserWindow,
  page: 'overlay' | 'conversation' | 'parametres' | 'bienvenue'
): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?page=${page}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { page } })
  }
}

/**
 * Les deux places de la barre à l'écran.
 *
 * On mesure la zone de travail, pas l'écran : la barre des tâches ne doit pas
 * recouvrir la pastille. `workArea` porte aussi l'origine, ce que
 * `workAreaSize` ignore — de quoi tout décaler dès qu'il y a deux écrans.
 */
function geometrie(forme: Forme): Electron.Rectangle {
  const zone = screen.getPrimaryDisplay().workArea
  if (forme === 'pastille') {
    // Assez large pour la colonne de bulles de tâches, à gauche de l'orbe.
    // La fenêtre est transparente et laisse passer les clics hors de ce qui
    // est dessiné (`setIgnoreMouseEvents`) : sa taille ne gêne rien derrière.
    const large = 400
    const haut = 320
    return {
      width: large,
      height: haut,
      x: zone.x + zone.width - large - 10,
      y: zone.y + Math.floor(zone.height / 2 - haut / 2)
    }
  }
  const large = 580
  const haut = 330
  return {
    width: large,
    height: haut,
    x: zone.x + Math.floor(zone.width / 2 - large / 2),
    // Posée au-dessus de la barre des tâches, avec assez d'air pour que la
    // nappe lumineuse s'éteigne avant le bord.
    y: zone.y + zone.height - haut - 18
  }
}

function creerOverlay(): void {
  const depart = geometrie('barre')

  overlay = new BrowserWindow({
    ...depart,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    // La barre ne prend jamais le focus, même cliquée : on l'invoque souvent
    // par-dessus un jeu ou une visio, et voler le focus y est brutal.
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      // Cette fenêtre doit répondre à l'instant où le raccourci tombe, et
      // continuer à jouer la voix une fois masquée.
      backgroundThrottling: false
    }
  })

  // Au-dessus des fenêtres plein écran également : on parle à Iris en jouant.
  overlay.setAlwaysOnTop(true, 'screen-saver')
  // Sur macOS, une app en plein écran a son propre bureau : sans ça, la barre
  // apparaîtrait sur un autre.
  if (process.platform === 'darwin') {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  overlayPret = new Promise((resolve) => {
    overlay?.webContents.once('did-finish-load', () => resolve())
  })

  // La barre des tâches peut changer de bord, ou l'écran de résolution : la
  // pastille se retrouverait dans le vide.
  screen.on('display-metrics-changed', () => overlay?.setBounds(geometrie(forme)))

  chargerPage(overlay, 'overlay')

  // L'overlay porte le micro, la veille et la voix : s'il tombe, Iris devient
  // sourde et muette sans que rien ne se voie. On note pourquoi, et on le
  // recharge.
  overlay.webContents.on('render-process-gone', (_e, details) => {
    noter(`overlay tombé (${details.reason}, code ${details.exitCode}) : rechargement`)
    abandonnerTour()
    poserEtat('repos')
    overlayPret = new Promise((resolve) => {
      overlay?.webContents.once('did-finish-load', () => resolve())
    })
    if (overlay) chargerPage(overlay, 'overlay')
  })
  overlay.webContents.on('unresponsive', () => noter('overlay ne répond plus'))
  // Les erreurs de l'overlay (micro, veille, lecture) remontent au journal.
  overlay.webContents.on('console-message', (...args: unknown[]) => {
    const details = args[0] as { level?: string | number; message?: string }
    const niveau = details?.level ?? args[1]
    const message = details?.message ?? args[2]
    if (niveau === 'error' || niveau === 3) noter(`overlay, erreur : ${String(message).slice(0, 300)}`)
  })
}

/** Couleurs de la barre de titre intégrée, accordées au thème courant. */
function habillageTitre(): Electron.TitleBarOverlayOptions {
  const sombre = nativeTheme.shouldUseDarkColors
  return {
    color: sombre ? '#1b1c1f' : '#fbfbfc',
    symbolColor: sombre ? '#e8e8ea' : '#3c3c42',
    height: 42
  }
}

/** L'habillage des fenêtres ordinaires, propre à chaque système. */
function cadre(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === 'darwin') return {}
  return { frame: false, titleBarStyle: 'hidden', titleBarOverlay: habillageTitre() }
}

function creerConversation(): void {
  conversation = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 420,
    minHeight: 480,
    show: false,
    icon: iconApp,
    title: 'Iris',
    // Barre de titre intégrée : l'en-tête est dessiné par le renderer, mais
    // les trois boutons restent ceux de Windows.
    // Sur macOS, la fenêtre classique : sans cadre, les trois pastilles de
    // fermeture disparaîtraient.
    ...cadre(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#fbfbfc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  chargerPage(conversation, 'conversation')

  // Fermer la fenêtre ne quitte pas : l'application vit dans la zone de
  // notification.
  conversation.on('close', (e) => {
    if (quitte) return
    e.preventDefault()
    conversation?.hide()
  })
}

/**
 * L'écran de bienvenue.
 *
 * Au premier lancement, tout ce qu'il faut à Iris manque encore : un prénom,
 * Claude Code connecté, une clé de transcription. Les paramètres les
 * demandaient sous forme de formulaire, ce qui suppose de savoir déjà ce que
 * chaque ligne veut dire. Ici, elle pose une chose à la fois et la vérifie.
 */
function creerBienvenue(): void {
  bienvenue = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 520,
    minHeight: 600,
    show: false,
    icon: iconApp,
    title: 'Bienvenue',
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#fbfbfc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  chargerPage(bienvenue, 'bienvenue')

  bienvenue.on('close', (e) => {
    if (quitte) return
    e.preventDefault()
    bienvenue?.hide()
  })

  // Les liens (compte Groq, documentation) partent dans le vrai navigateur.
  bienvenue.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function ouvrirBienvenue(): void {
  bienvenue?.show()
  bienvenue?.focus()
}

function creerParametres(): void {
  parametres = new BrowserWindow({
    width: 560,
    height: 780,
    minWidth: 480,
    minHeight: 520,
    show: false,
    icon: iconApp,
    title: 'Iris — Paramètres',
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#fbfbfc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  chargerPage(parametres, 'parametres')

  parametres.on('close', (e) => {
    if (quitte) return
    e.preventDefault()
    parametres?.hide()
  })

  // La liste des microphones ne se lit qu'une fois l'accès accordé, donc en
  // ouvrant le flux : le faire au démarrage allumerait le témoin du micro sans
  // que personne n'ait rien demandé.
  parametres.on('show', () => parametres?.webContents.send('parametres-affiches'))

  parametres.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function ouvrirConversation(): void {
  conversation?.show()
  conversation?.focus()
}

function ouvrirParametres(): void {
  parametres?.show()
  parametres?.focus()
}

// ─── Zone de notification ────────────────────────────────────────────────────

/**
 * Deux PNG plutôt qu'un ICO : Electron ramène l'ICO à 256 pixels avant de le
 * rendre, et le glyphe revient flou une fois redescendu à 16.
 */
function iconeTray(): Electron.NativeImage {
  const base =
    etat === 'repos' || etat === 'erreur'
      ? nativeTheme.shouldUseDarkColors
        ? 'tray-dark'
        : 'tray-light'
      : 'tray-actif'

  const image = nativeImage.createFromPath(join(assetsDir, `${base}-16.png`))
  try {
    image.addRepresentation({
      scaleFactor: 2,
      buffer: fs.readFileSync(join(assetsDir, `${base}-32.png`))
    })
  } catch {
    // Une icône manquante ne doit pas interrompre le démarrage : sans ce
    // filet, l'exception traversait `app.whenReady()` et aucun canal IPC
    // n'était plus enregistré — l'application se lançait à moitié.
  }
  return image
}

const LIBELLE: Record<Etat, string> = {
  repos: 'au repos',
  ecoute: 'elle écoute…',
  transcription: 'transcription…',
  reflexion: 'elle réfléchit…',
  parole: 'elle parle…',
  erreur: 'erreur'
}

/**
 * La mise à jour tient dans le menu de l'icône : Iris n'a pas de fenêtre
 * d'application où l'annoncer, et elle ne s'installe jamais sans qu'on le
 * demande, puisqu'elle se ferme pour ça.
 */
function entreeMiseAJour(): Electron.MenuItemConstructorOptions[] {
  const maj = updates.currentState()
  if (maj.statut === 'disponible') {
    return [
      {
        label:
          process.platform === 'darwin'
            ? `Version ${maj.version} disponible…`
            : `Télécharger la version ${maj.version}`,
        click: () => void updates.telecharger()
      }
    ]
  }
  if (maj.statut === 'telechargement') {
    return [{ label: `Téléchargement de la ${maj.version}… ${maj.progres} %`, enabled: false }]
  }
  if (maj.statut === 'prete') {
    return [
      {
        label: `Redémarrer pour passer à la ${maj.version}`,
        // Les fenêtres se cachent au lieu de se fermer tant qu'on ne quitte
        // pas : sans ce drapeau, elles retiendraient la fermeture.
        click: () => {
          quitte = true
          updates.installer()
        }
      }
    ]
  }
  if (maj.statut === 'indisponible') return []
  return [
    {
      label: maj.statut === 'verification' ? 'Recherche d’une mise à jour…' : 'Rechercher une mise à jour',
      enabled: maj.statut !== 'verification',
      click: () => void updates.verifier()
    }
  ]
}

function menuTray(): Menu {
  const maj = entreeMiseAJour()
  return Menu.buildFromTemplate([
    { label: `Iris ${app.getVersion()} — ${LIBELLE[etat]}`, enabled: false },
    { label: `Raccourci : ${reglages.raccourci}`, enabled: false },
    ...maj,
    { type: 'separator' },
    { label: 'Parler à Iris', click: () => void basculer() },
    { label: 'Nouvelle conversation', click: repartirDeZero },
    { type: 'separator' },
    // Rangé ici et nulle part ailleurs : c'est un journal, pas une façon de
    // se servir d'Iris.
    { label: 'Historique', click: ouvrirConversation },
    { label: 'Guide de démarrage', click: ouvrirBienvenue },
    { label: 'Paramètres', click: ouvrirParametres },
    { label: 'Quitter', click: quitter }
  ])
}

function rafraichirTray(): void {
  if (!tray) return
  tray.setImage(iconeTray())
  tray.setToolTip(`Iris — ${LIBELLE[etat]}`)
  tray.setContextMenu(menuTray())
}

function creerTray(): void {
  tray = new Tray(iconeTray())
  // Sous Windows le clic gauche n'ouvre rien par défaut, et l'icône paraît
  // alors morte. Il ouvrait la conversation écrite ; il appelle Iris, comme
  // son nom ou le raccourci, puisque c'est une application qu'on écoute.
  tray.on('click', () => void basculer())
  rafraichirTray()

  nativeTheme.on('updated', () => {
    rafraichirTray()
    conversation?.setTitleBarOverlay?.(habillageTitre())
  })
}

// ─── Tour de parole ──────────────────────────────────────────────────────────

function ajouterTour(tour: Tour): void {
  tours.push(tour)
  diffuser('tour', tour)
}

/**
 * Change la forme de la barre.
 *
 * La fenêtre change de taille et de place, donc la transition ne peut pas être
 * un simple morphing CSS : le renderer joue une sortie, on déplace, il joue
 * une entrée. `setResizable` encadre le déplacement parce que Windows borne
 * `setBounds` sur une fenêtre non redimensionnable.
 */
async function poserForme(suivante: Forme): Promise<void> {
  if (forme === suivante || !overlay) return
  forme = suivante

  // Masquée, il n'y a rien à animer, et attendre ouvrirait une fenêtre de
  // course : un raccourci pendant l'attente montrerait la barre à la place de
  // la pastille, ou l'inverse.
  if (overlay.isVisible()) {
    overlay.webContents.send('forme-part')
    await new Promise((r) => setTimeout(r, 150))
    if (!overlay || overlay.isDestroyed() || forme !== suivante) return
  }

  overlay.setResizable(true)
  overlay.setBounds(geometrie(suivante))
  overlay.setResizable(false)
  // En pastille, la fenêtre est surtout du vide : les clics le traversent, et
  // le renderer ne les reprend qu'au survol de l'orbe (canal `survol`).
  // `forward` garde les mouvements de souris, sans quoi ce survol ne serait
  // jamais détecté.
  if (suivante === 'pastille') overlay.setIgnoreMouseEvents(true, { forward: true })
  else overlay.setIgnoreMouseEvents(false)
  overlay.webContents.send('forme', suivante)
}

/** Arme le retrait sur le côté : au-delà du délai sans un mot, Iris s'efface. */
function armerRetrait(): void {
  if (retrait) clearTimeout(retrait)
  retrait = setTimeout(() => {
    retrait = null
    // Elle parle, ou elle a fini : sa place est en face.
    if (epingle || etat !== 'reflexion') return
    void poserForme('pastille')
  }, AVANT_RETRAIT)
}

function desarmerRetrait(): void {
  if (!retrait) return
  clearTimeout(retrait)
  retrait = null
}

/** Le temps que dure la sortie à l'écran, avant que la fenêtre se cache. */
const DUREE_SORTIE = 210

/** Montre l'overlay sans lui donner le focus, et annule un repli en attente. */
async function montrerOverlay(): Promise<void> {
  if (replier) {
    clearTimeout(replier)
    replier = null
  }
  await overlayPret
  // Toujours envoyé, même déjà visible : une sortie interrompue laisserait la
  // barre à demi effacée.
  overlay?.webContents.send('apparition')
  if (!overlay?.isVisible()) overlay?.showInactive()
}

/**
 * Cache l'overlay après l'avoir laissé s'effacer.
 *
 * `hide()` seul le faisait disparaître d'un coup, en plein milieu d'une
 * phrase à l'écran : on joue la sortie, puis on cache. Si quelque chose
 * reprend pendant ces deux cents millisecondes, on ne cache plus rien.
 */
function masquerOverlay(): void {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) {
    overlay?.hide()
    return
  }
  overlay.webContents.send('disparition')
  setTimeout(() => {
    if (!overlay || overlay.isDestroyed()) return
    // Rappelée entre-temps : sa place est à l'écran, pas cachée.
    if (occupee()) {
      overlay.webContents.send('apparition')
      return
    }
    overlay.hide()
  }, DUREE_SORTIE)
}

/**
 * Iris se montre au démarrage et dit comment l'appeler, puis s'efface.
 *
 * La toute première fois, elle se présente et reste un peu plus longtemps ;
 * ensuite, un rappel bref suffit à dire qu'elle est lancée.
 */
/**
 * Le carillon du lancement.
 *
 * Il passe par l'overlay, seule fenêtre à avoir une sortie audio, et par un
 * canal à part de la voix : il ne doit ni entrer dans la file de lecture, ni
 * être coupé par un « tais-toi ». Synthétisé dans `son/generer.mjs`.
 */
function jouerSonDemarrage(): void {
  if (reglages.sonDemarrage === 'aucun') return
  try {
    const octets = fs.readFileSync(join(assetsDir, 'son', `${reglages.sonDemarrage}.wav`))
    overlay?.webContents.send('son', octets.toString('base64'))
  } catch {
    // Fichier absent : le démarrage se fait en silence, sans rien signaler.
  }
}

async function annoncer(): Promise<void> {
  noter(`démarrage ${app.getVersion()}, réveil au mot ${reglages.veille ? 'actif' : 'coupé'}`)
  const appel = reglages.veille ? 'Dis « Iris »' : `${reglages.raccourci.replace(/\+/g, ' + ')}`
  const texte = premierLancement
    ? `${appel} quand tu as besoin de moi.`
    : `${appel}, je suis là.`
  await montrerOverlay()
  jouerSonDemarrage()
  overlay?.webContents.send('annonce', texte)
  replierOverlay(premierLancement ? 5000 : 2600)
}

/** Iris a quelque chose en cours : la barre doit rester à l'écran. */
function occupee(): boolean {
  return etat === 'ecoute' || etat === 'transcription' || etat === 'reflexion' || etat === 'parole'
}

function replierOverlay(delai: number): void {
  if (replier) clearTimeout(replier)
  replier = setTimeout(() => {
    replier = null
    // Un nouveau tour a pu démarrer pendant l'attente.
    if (occupee()) return
    // L'état d'erreur se replie comme le repos : il ne l'a pas fait pendant
    // longtemps, et la barre restait collée à l'écran après un échec.
    if (etat === 'erreur') poserEtat('repos')
    masquerOverlay()
    // Masquée, elle reprend sa forme d'échange : le prochain raccourci doit
    // ouvrir le micro en face de soi, pas sur le bord de l'écran.
    setTimeout(() => void poserForme('barre'), DUREE_SORTIE)
  }, delai)
}

/**
 * Tout arrêter et rendre l'écran.
 *
 * C'est ce que fait la croix de la barre. Elle appelait le raccourci, qui, au
 * repos comme après une erreur, **relançait** l'écoute : le bouton pour
 * fermer rouvrait l'outil.
 */
/** Numéro du tour en cours : un tour dont le numéro a changé est abandonné. */
let tourCourant = 0

/**
 * Abandonne le tour en cours : agent, voix, micro et lecture.
 *
 * Le numéro change d'abord. `poser()` reprenait la main une fois l'agent
 * arrêté et réécrivait l'état (« erreur » d'un process tué, fin de réponse)
 * par-dessus l'écoute qui venait de commencer : Iris restait sourde.
 */
function abandonnerTour(): void {
  tourCourant++
  tourEnCours = false
  terminerQuestion('', 'échange interrompu')
  terminerConfirmation(false, 'échange interrompu')
  cerveau.interrompre()
  diseur?.taire()
  diseur = null
  desarmerRetrait()
  // Coupe aussi l'enregistrement et la lecture côté renderer.
  overlay?.webContents.send('taire')
}

function congedier(): void {
  abandonnerTour()
  if (replier) {
    clearTimeout(replier)
    replier = null
  }
  poserEtat('repos')
  masquerOverlay()
  setTimeout(() => void poserForme('barre'), DUREE_SORTIE)
}

/**
 * Le cœur : une question part à l'agent, son texte revient par morceaux, et
 * chaque phrase terminée est prononcée sans attendre la suite.
 */
async function poser(question: string): Promise<void> {
  const propre = question.trim()
  if (!propre) {
    poserEtat('repos')
    replierOverlay(200)
    return
  }

  const monTour = ++tourCourant
  /** Le tour a été abandonné entre-temps : il ne touche plus à rien. */
  const perime = (): boolean => monTour !== tourCourant

  await montrerOverlay()
  ajouterTour({
    id: prochainId++,
    role: 'moi',
    texte: propre,
    outils: [],
    taches: [],
    termine: true
  })

  const id = prochainId++
  const tour: Tour = { id, role: 'iris', texte: '', outils: [], taches: [], termine: false }
  ajouterTour(tour)
  tourEnCours = true
  poserEtat('reflexion')
  // Chaque tour repart en face de soi, et l'épinglage du tour précédent ne
  // vaut plus.
  epingle = false
  await poserForme('barre')
  // Si la réponse tarde, Iris n'a rien à faire devant les yeux.
  armerRetrait()

  // Le tri : quel modèle, et la suite du sujet ou un nouveau ? Il passe
  // pendant que l'écran dit déjà « je m'en occupe ».
  const enSuite = ecouteEnSuite
  ecouteEnSuite = false
  const tri = await trier(propre, {
    enSuite,
    precedent,
    cleGroq: reglages.fournisseur === 'groq' ? reglages.cleApi : ''
  })
  if (perime()) return
  const impose = ['haiku', 'sonnet', 'opus'].includes(reglages.modele)
    ? (reglages.modele as Modele)
    : null
  // Un modèle dit à la voix l'emporte sur celui des réglages.
  const choisi = tri.source === 'voix' ? tri.modele : (impose ?? tri.modele)
  const rang: Record<Modele, number> = { haiku: 0, sonnet: 1, opus: 2 }
  // Dans un même sujet, on garde le plus capable des deux : changer de modèle
  // en cours de route coûte une reprise, et redescendre coûte la réponse.
  const modele =
    tri.suite && tri.source !== 'voix' && modeleCourant && rang[modeleCourant] > rang[choisi]
      ? modeleCourant
      : choisi
  modeleCourant = tri.suite ? modele : choisi
  noter(
    `tri : ${modele}${modele === choisi ? '' : ` (tenu, ${choisi} proposé)`}, ${tri.suite ? 'suite du sujet' : 'nouveau sujet'} (${tri.source})`
  )

  diseur = reglages.parler
    ? new Diseur(
        reglages,
        (mp3) => {
        // La voix est jouée par l'overlay : le main n'a pas de sortie audio,
        // et une fenêtre sait interrompre une lecture en cours.
        if (etat !== 'erreur') poserEtat('parole')
        // Elle a quelque chose à dire : sa place est de nouveau en face.
        desarmerRetrait()
        void poserForme('barre')
        // Une phrase synthétisée lentement peut arriver après que la file se
        // soit vidée et que la barre se soit repliée : Iris parlerait alors
        // sans rien à l'écran.
        void montrerOverlay()
          overlay?.webContents.send('audio', mp3.toString('base64'))
        },
        noter
      )
    : null

  const surEvenement = (e: EvenementTour): void => {
    // Un agent qu'on vient d'arrêter envoie encore quelques morceaux : ils
    // iraient dans la voix du tour suivant, qui utilise le même `diseur`.
    if (perime()) return
    if (e.type === 'texte') {
      tour.texte += e.delta
      diseur?.pousser(e.delta)
    } else if (e.type === 'outil') {
      tour.outils.push(e.outil)
    } else if (e.type === 'taches') {
      tour.taches = e.taches
    } else if (e.type === 'fin') {
      // Le texte de `result` fait foi : les deltas peuvent manquer la fin.
      if (e.texte) tour.texte = e.texte
      tour.erreur = e.erreur
      tour.termine = true
    }
    diffuser('evenement', e)
  }

  await cerveau.demander(propre, reglages, id, { modele, suite: tri.suite }, surEvenement)
  if (perime()) return
  tourEnCours = false
  if (!tour.erreur) precedent = { question: propre, reponse: tour.texte, fin: Date.now() }

  // Le tour est fini : qu'il y ait une réponse, une erreur ou rien, cela se
  // dit en face et pas sur le bord de l'écran.
  desarmerRetrait()
  await poserForme('barre')
  if (perime()) return

  if (tour.erreur) {
    diseur?.taire()
    diseur = null
    poserEtat('erreur')
    // Assez long pour lire le message : l'overlay n'a pas le focus et ne
    // répond à aucune touche.
    replierOverlay(6000)
    return
  }

  if (!diseur) {
    apresReponse(2500)
    return
  }

  diseur.terminer()
  await diseur.attendre()
  if (perime()) return
  // `parole-finie` viendra du renderer quand la file de lecture sera vide ;
  // si rien n'a été synthétisé, personne ne l'enverra.
  if (etat !== 'parole') apresReponse(2500)
  else overlay?.webContents.send('syntheses-finies')
}

// ─── Raccourci ───────────────────────────────────────────────────────────────

function enregistrerRaccourci(raccourci: string): boolean {
  globalShortcut.unregisterAll()
  try {
    return globalShortcut.register(raccourci, basculer)
  } catch {
    return false
  }
}

/**
 * Une seule touche pour tout : elle ouvre le micro, le referme, et coupe Iris
 * quand elle parle ou travaille. C'est le geste d'un talkie-walkie, pas un
 * menu d'actions.
 */
async function basculer(): Promise<void> {
  if (etat === 'ecoute') {
    overlay?.webContents.send('arreter-ecoute')
    return
  }

  // La question de l'agent est encore en train d'être dite : le raccourci la
  // laisse sans réponse, comme on tournerait les talons.
  if (question) {
    overlay?.webContents.send('taire')
    terminerQuestion('', 'raccourci')
    return
  }
  // La question de confirmation est encore en train d'être dite : le
  // raccourci vaut refus, comme on couperait quelqu'un d'un « non ».
  if (confirmation) {
    overlay?.webContents.send('taire')
    terminerConfirmation(false, 'raccourci')
    return
  }

  if (etat === 'reflexion' || etat === 'parole') {
    abandonnerTour()
    poserEtat('repos')
    replierOverlay(600)
    return
  }

  await ecouter('demande')
}

/**
 * Ouvre le micro.
 *
 * `suite` : Iris vient de répondre et reste à l'écoute, sans qu'on ait à
 * redire son nom. Sans ça, l'échange mourait à la fin de chaque réponse, y
 * compris quand elle venait de poser une question.
 *
 * `confirmation` : la réponse attendue est un oui ou un non, qui va au garde
 * et non à l'agent.
 */
async function ecouter(mode: ModeEcoute): Promise<void> {
  // macOS demande l'accès au micro au niveau du système, avant Chromium.
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone')

  ecouteEnSuite = mode === 'suite'
  poserEtat('ecoute')
  // On parle toujours en face de soi, jamais au bord de l'écran.
  await poserForme('barre')
  await montrerOverlay()
  overlay?.webContents.send('demarrer-ecoute', reglages, mode)
}

// ─── Confirmation vocale ─────────────────────────────────────────────────────

/**
 * Un oui, sous toutes ses formes dites. Tout le reste, silence compris, est un
 * non : devant l'irréversible, le doute refuse.
 */
function estOui(texte: string): boolean {
  const t = texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z' -]/g, ' ')
  if (/\b(non|pas|jamais|annule|stop|arrete|attends|laisse|surtout)\b/.test(t)) return false
  return /\b(oui|ouais|ouai|vas-y|vas y|confirme|ok|okay|d'accord|dac|fais-le|fais le|go|valide|c'est bon|yes|bien sur|exactement|carrement)\b/.test(
    t
  )
}

/**
 * Le garde demande : Iris pose la question à voix haute, puis écoute la
 * réponse. La promesse rend oui ou non, jamais d'erreur.
 */
function demanderConfirmation(action: string): Promise<boolean> {
  noter(`confirmation demandée : ${action}`)
  // Une seule question à la fois : une seconde demande pendant la première
  // viendrait d'un agent qui n'attend pas, on la refuse.
  if (confirmation) return Promise.resolve(false)

  return new Promise((resolve) => {
    // Sans réponse, rien ne se fait.
    const minuterie = setTimeout(() => terminerConfirmation(false, 'sans réponse'), 45000)
    confirmation = {
      action,
      audioEnvoye: false,
      resoudre: (ok) => {
        clearTimeout(minuterie)
        resolve(ok)
      }
    }

    const phrase = `${action.replace(/[.\s]+$/, '')}. Tu confirmes ?`
    desarmerRetrait()
    diffuser('confirmation', phrase)

    if (!reglages.parler) {
      void ecouter('confirmation')
      return
    }
    poserEtat('parole')
    void poserForme('barre').then(montrerOverlay)
    synthetiser(phrase, reglages)
      .then((mp3) => {
        if (!confirmation) return
        confirmation.audioEnvoye = true
        overlay?.webContents.send('audio', mp3.toString('base64'))
      })
      // La voix a échoué : la question reste écrite, on écoute quand même.
      .catch(() => {
        if (confirmation) void ecouter('confirmation')
      })
  })
}

/**
 * Iris pose la question de l'agent et rend la réponse.
 *
 * Même chemin que la confirmation — elle parle, puis écoute — mais la réponse
 * n'est pas un oui ou un non : c'est une phrase, rendue telle quelle à l'agent
 * qui attend. Sans réponse, une chaîne vide : à lui de trancher prudemment.
 */
function demanderPrecision(
  texte: string,
  genre: 'precision' | 'autorisation' = 'precision'
): Promise<string> {
  noter(`question posée (${genre}) : ${texte.slice(0, 80)}`)
  // Une seule à la fois : un agent qui en poserait deux d'affilée n'attend pas
  // vraiment de réponse.
  if (question || confirmation) return Promise.resolve('')

  return new Promise((resolve) => {
    const minuterie = setTimeout(() => terminerQuestion('', 'sans réponse'), 90000)
    question = {
      texte,
      genre,
      audioEnvoye: false,
      resoudre: (reponse) => {
        clearTimeout(minuterie)
        resolve(reponse)
      }
    }

    // La barre revient en face : c'est à lui de parler, il doit la voir.
    desarmerRetrait()
    diffuser('confirmation', { texte, genre })

    if (!reglages.parler) {
      void poserForme('barre').then(montrerOverlay).then(() => ecouter('question'))
      return
    }
    poserEtat('parole')
    void poserForme('barre').then(montrerOverlay)
    synthetiser(texte, reglages)
      .then((mp3) => {
        if (!question) return
        question.audioEnvoye = true
        overlay?.webContents.send('audio', mp3.toString('base64'))
      })
      .catch(() => {
        // La voix a échoué : la question reste écrite, on écoute quand même.
        if (question) void ecouter('question')
      })
  })
}

function terminerQuestion(reponse: string, raison: string): void {
  const q = question
  if (!q) return
  question = null
  noter(`réponse à la question : ${reponse ? reponse.slice(0, 60) : `(rien — ${raison})`}`)
  diffuser('confirmation', null)
  q.resoudre(reponse)
  // L'agent reprend son travail : on le retrouve au travail, sur le côté.
  if (tourEnCours) {
    poserEtat('reflexion')
    armerRetrait()
  }
}

/**
 * L'agent est bloqué faute de droits : Iris demande l'accès complet.
 *
 * C'est le seul endroit où les autorisations changent toutes seules, et
 * seulement sur un oui : le mode passe à « Tout » (les actions irréversibles
 * restent soumises au garde) et le dossier de l'utilisateur s'ouvre en entier.
 * Un bouton s'affiche dans la barre, parce qu'on n'a pas toujours envie de
 * dire « oui » à voix haute devant quelqu'un.
 */
async function demanderAutorisation(raison: string): Promise<boolean> {
  if (reglages.permission === 'total' && reglages.etendu) return true

  const propre = raison.replace(/[.\s]+$/, '')
  const dit = await demanderPrecision(
    `${propre}. Je n'ai pas les droits qu'il faut. Tu me les donnes ?`,
    'autorisation'
  )
  if (!estOui(dit)) {
    noter('autorisation refusée')
    return false
  }
  accorderTout()
  return true
}

/** Passe Iris en accès complet, et relance les Claude Code d'avance. */
function accorderTout(): void {
  reglages = { ...reglages, permission: 'total', etendu: true }
  enregistrerReglages(reglages)
  rafraichirTray()
  cerveau.invalider(reglages)
  diffuser('reglages', reglages)
  noter('autorisation accordée : accès complet')
}

function terminerConfirmation(ok: boolean, raison: string): void {
  const c = confirmation
  if (!c) return
  confirmation = null
  noter(`confirmation : ${ok ? 'oui' : 'non'} (${raison})`)
  diffuser('confirmation', null)
  c.resoudre(ok)
  // L'agent reprend la main : on le retrouve au travail, sur le côté.
  if (tourEnCours) {
    poserEtat('reflexion')
    armerRetrait()
  }
}

/**
 * La réponse est finie (dite, ou affichée si la voix est coupée) : on rend la
 * parole, ou on se retire.
 */
function apresReponse(delaiRepli: number): void {
  poserEtat('repos')
  if (!reglages.suite) {
    replierOverlay(delaiRepli)
    return
  }
  // Un temps avant de rouvrir le micro : la fin de sa propre phrase, encore
  // dans les enceintes, serait enregistrée comme le début de la nôtre.
  setTimeout(() => {
    if (etat === 'repos') void ecouter('suite')
  }, 350)
}

function repartirDeZero(): void {
  abandonnerTour()
  cerveau.oublier()
  tours.length = 0
  diffuser('fil-vide')
  poserEtat('repos')
}

function quitter(): void {
  quitte = true
  app.quit()
}

// ─── Mémoire d'Iris ──────────────────────────────────────────────────────────

/**
 * Ce qu'Iris apprend, dans des fichiers à elle.
 *
 * Trois choses distinctes, parce qu'elles ne se relisent pas au même moment :
 * un mémo court, qui entre en entier dans chaque consigne ; des fiches, une
 * par sujet, dont seul le sommaire est donné et qu'elle ouvre quand le sujet
 * revient ; et un journal mensuel de ce qu'elle a fait, pour répondre à
 * « qu'est-ce que tu as fait hier ? ». Tout charger à chaque question ferait
 * grossir la consigne sans fin.
 *
 * Le tout est séparé de la mémoire que Claude Code tient pour le dossier des
 * projets : celle-là sert au développement, celle-ci à la vie de tous les
 * jours (quel navigateur, quelle habitude, ce qu'on a fait ensemble).
 */
const dossierMemoire = join(app.getPath('userData'), 'memoire')
const cheminMemoire = join(dossierMemoire, 'memoire.md')
const dossierFiches = join(dossierMemoire, 'fiches')
const dossierJournalMemoire = join(dossierMemoire, 'journal')
/** Au-delà, la consigne s'alourdit à chaque question pour peu de profit. */
const TAILLE_MEMOIRE = 8000
/** Le sommaire des fiches passe dans chaque consigne : il doit rester court. */
const FICHES_MAX = 60

/** Le journal du mois : un fichier par mois, pour qu'aucun ne devienne illisible. */
function journalDuMois(): string {
  const maintenant = new Date()
  const mois = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}`
  return join(dossierJournalMemoire, `${mois}.md`)
}

/**
 * Le sommaire des fiches : leur nom, et la première ligne de texte de
 * chacune. C'est cette ligne qui dit à Iris si la fiche vaut le détour, donc
 * la consigne lui demande d'en écrire une en tête.
 */
function sommaireFiches(): { nom: string; resume: string }[] {
  try {
    return fs
      .readdirSync(dossierFiches)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort()
      .slice(0, FICHES_MAX)
      .map((nom) => {
        let resume = ''
        try {
          const lignes = fs.readFileSync(join(dossierFiches, nom), 'utf-8').split(/\r?\n/)
          resume = lignes.find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? ''
        } catch {
          // Fiche illisible : elle reste listée, Iris l'ouvrira si besoin.
        }
        return { nom, resume: resume.slice(0, 120) }
      })
  } catch {
    return []
  }
}

/** Le nom de l'application qui ouvre les liens, lu dans le registre. */
function navigateurParDefaut(): string {
  if (process.platform !== 'win32') return ''
  try {
    const choix = execFileSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v',
        'ProgId'
      ],
      { encoding: 'utf-8', windowsHide: true }
    )
    const progId = choix.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1]
    if (!progId) return ''
    const appli = execFileSync(
      'reg',
      ['query', `HKCU\\Software\\Classes\\${progId}\\Application`, '/v', 'ApplicationName'],
      { encoding: 'utf-8', windowsHide: true }
    )
    return appli.match(/ApplicationName\s+REG_SZ\s+(.+)/)?.[1]?.trim() ?? progId
  } catch {
    return ''
  }
}

/**
 * Crée la mémoire au premier lancement, avec ce qu'on sait déjà de la
 * machine. Le cas qui l'a motivée : « mets YouTube » ouvrait le navigateur par
 * défaut (Arc), qui demandait un profil, alors que Lucas vit dans Firefox.
 */
function initialiserMemoire(): void {
  // Les dossiers d'abord : ils manquent aussi aux mémoires créées avant les
  // fiches, et l'agent n'a pas à les créer lui-même.
  fs.mkdirSync(dossierFiches, { recursive: true })
  fs.mkdirSync(dossierJournalMemoire, { recursive: true })
  if (fs.existsSync(cheminMemoire)) return

  const mac = process.platform === 'darwin'
  const firefox = (
    mac
      ? ['/Applications/Firefox.app']
      : [
          'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
          'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
        ]
  ).find((c) => fs.existsSync(c))
  const parDefaut = navigateurParDefaut()

  const lignes = [
    "# Mémoire d'Iris",
    '',
    'Ce qu’Iris a appris sur la personne qui lui parle et sur cette machine. Une ligne courte par fait.',
    '',
    `## ${reglages.prenom || 'La personne'}`,
    // Le seul portrait connu d'avance est celui de Lucas, pour qui Iris a été
    // faite : ailleurs, elle l'apprend en parlant.
    ...(reglages.prenom === 'Lucas'
      ? ['- Designer UI/UX à Amiens. Il tutoie, veut des réponses courtes, sans formule.']
      : []),
    '',
    '## Cette machine',
    ...(firefox
      ? [
          mac
            ? '- Son navigateur est Firefox. Pour ouvrir un site : open -a Firefox "<adresse>".'
            : `- Son navigateur est Firefox : ${firefox}. Pour ouvrir un site : & "${firefox}" "<adresse>".`
        ]
      : []),
    ...(parDefaut && !/firefox/i.test(parDefaut)
      ? [
          `- Le navigateur par défaut de Windows est ${parDefaut}, pas le sien : ne jamais ouvrir une adresse avec start ou Start-Process, ça lancerait ${parDefaut}, qui demande un profil.`
        ]
      : []),
    '',
    '## Habitudes',
    ''
  ]
  fs.writeFileSync(cheminMemoire, lignes.join('\n'), 'utf-8')
}

function lireMemoire(): Memoire {
  try {
    return {
      chemin: cheminMemoire,
      contenu: fs.readFileSync(cheminMemoire, 'utf-8').slice(0, TAILLE_MEMOIRE),
      dossierFiches,
      fiches: sommaireFiches(),
      journal: journalDuMois()
    }
  } catch {
    return { chemin: '', contenu: '', dossierFiches: '', fiches: [], journal: '' }
  }
}

/**
 * Démarre ce qui permet à Iris de répondre vite et d'agir sans danger : le
 * garde de l'irréversible, puis les Claude Code d'avance.
 */
async function demarrerCerveau(): Promise<void> {
  try {
    initialiserMemoire()
  } catch (err) {
    noter(`mémoire indisponible : ${String(err).slice(0, 120)}`)
  }
  cerveau.brancherMemoire(lireMemoire)

  const garde = await demarrerGarde(join(assetsDir, 'garde.cjs'), {
    confirmer: demanderConfirmation,
    demander: (texte) => demanderPrecision(texte),
    autoriser: demanderAutorisation
  })
  noter(
    garde?.hook
      ? 'garde prêt'
      : garde
        ? 'garde indisponible (Node introuvable ?) : « Tout » retombe sur l’écriture seule'
        : 'serveur local indisponible : ni garde, ni questions'
  )
  cerveau.brancher({ garde, journal: noter })
  cerveau.preparer(reglages)
}

// ─── Cycle de vie ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Les deux gestionnaires de permissions ont un rôle distinct : le contrôle
  // synchrone répond aussi à `navigator.permissions.query()`, que le renderer
  // interroge avant `getUserMedia`. Y refuser le micro fermerait la boucle
  // avant même la demande.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'microphone', 'audioCapture'].includes(permission)
  )
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(['media', 'microphone', 'audioCapture'].includes(permission))
  )
  session.defaultSession.setDevicePermissionHandler(() => true)

  app.setAppUserModelId('com.luth.iris')
  app.dock?.hide()

  creerOverlay()
  creerConversation()
  creerParametres()
  creerBienvenue()
  creerTray()
  updates.onChange((maj) => {
    rafraichirTray()
    if (maj.statut === 'prete') noter(`mise à jour ${maj.version} prête`)
  })
  updates.surveiller()
  void demarrerCerveau()

  // Le raccourci d'abord, dans tous les cas : le guide peut être refermé en
  // cours de route, et Iris doit répondre quand même.
  const raccourciPris = !enregistrerRaccourci(reglages.raccourci)

  if (premierLancement) {
    // Rien n'est réglé : une phrase à l'écran n'apprendrait pas à s'en servir,
    // et le premier « Iris » échouerait faute de cerveau et de clé.
    ouvrirBienvenue()
  } else if (raccourciPris) {
    // Raccourci pris par une autre application : sans fenêtre ouverte
    // personne ne le saurait.
    ouvrirParametres()
  } else {
    // Iris se montre un instant au démarrage, puis s'efface. Sans ça, rien
    // n'apparaît à l'écran et l'application passe pour n'avoir pas démarré ;
    // ouvrir la conversation écrite à la place en faisait une messagerie.
    void annoncer()
  }

  // ─── IPC ──────────────────────────────────────────────────────────────────

  ipcMain.handle('reglages', () => reglages)

  ipcMain.handle('enregistrer-reglages', (_, recu: unknown) => {
    const precedent = reglages.raccourci
    const suivant = normalizeReglages(recu)

    if (suivant.raccourci !== precedent && !enregistrerRaccourci(suivant.raccourci)) {
      // On remet l'ancien : sans raccourci enregistré, plus rien ne déclenche
      // l'application.
      enregistrerRaccourci(precedent)
      return { ok: false, erreur: 'Ce raccourci est déjà pris par une autre application.' }
    }

    reglages = suivant
    enregistrerReglages(reglages)
    rafraichirTray()
    // Les Claude Code d'avance ont été lancés avec les anciens réglages.
    cerveau.invalider(reglages)
    // L'overlay tient la veille : sans cette diffusion, cocher le réveil au
    // mot « Iris » n'aurait d'effet qu'au prochain démarrage.
    diffuser('reglages', reglages)
    return { ok: true }
  })

  ipcMain.handle('etat', () => etat)
  ipcMain.handle('tours', () => tours)
  ipcMain.handle('version', () => app.getVersion())

  // L'overlay a fini de transcrire : la question part à l'agent.
  ipcMain.on('question', (_, texte: string) => {
    // L'agent attend une précision : cette phrase est sa réponse, pas une
    // nouvelle demande.
    if (question) {
      terminerQuestion(texte, 'dite')
      return
    }
    // En pleine confirmation, ce qu'on vient de dire est un oui ou un non,
    // pas une nouvelle demande.
    if (confirmation) {
      terminerConfirmation(estOui(texte), `« ${texte.slice(0, 40)} »`)
      return
    }
    noter(`question : ${texte.slice(0, 80)}`)
    void poser(texte)
  })

  // Écoute abandonnée (silence, erreur de transcription, Échap).
  ipcMain.on('ecoute-annulee', () => {
    // Rien dit : l'agent reprend sans la précision.
    if (question) {
      terminerQuestion('', 'silence')
      return
    }
    if (confirmation) {
      terminerConfirmation(false, 'pas de réponse')
      return
    }
    // Une écoute périmée qui s'éteint pendant qu'Iris parle ne la range pas.
    if (etat === 'parole') return
    poserEtat('repos')
    replierOverlay(400)
  })

  ipcMain.on('ecoute-erreur', (_, message: string) => {
    if (question) terminerQuestion('', 'micro en erreur')
    if (confirmation) terminerConfirmation(false, 'micro en erreur')
    poserEtat('erreur')
    diffuser('erreur', message)
    replierOverlay(6000)
  })

  // Le renderer passe de « je transcris » à « j'attends l'agent ».
  ipcMain.on('transcription', () => poserEtat('transcription'))

  // La file de lecture est vide : Iris a fini ce qu'elle avait à dire.
  ipcMain.on('parole-finie', () => {
    // La question de l'agent vient d'être dite : on écoute la réponse.
    if (question?.audioEnvoye) {
      void ecouter('question')
      return
    }
    // La question de confirmation vient d'être dite : on écoute la réponse.
    if (confirmation?.audioEnvoye) {
      void ecouter('confirmation')
      return
    }
    if (etat !== 'parole') return
    // La phrase suivante est encore en synthèse : la lecture a rattrapé la
    // voix, rien de plus. Conclure ici rouvrait le micro, et l'écoute sans
    // réponse repliait la barre pendant qu'Iris parlait encore.
    if (diseur?.occupe) return
    // Une phrase dite en cours de travail (« je m'en occupe ») n'est pas la
    // fin de la réponse. Rouvrir le micro ici, c'était écouter Lucas pendant
    // que l'agent travaillait encore.
    if (tourEnCours) {
      poserEtat('reflexion')
      armerRetrait()
      return
    }
    apresReponse(2000)
  })

  ipcMain.on('basculer', () => void basculer())
  ipcMain.on('congedier', congedier)

  // Clic sur la pastille : Iris revient en face et y reste jusqu'à la fin du
  // tour, même si le travail dure.
  ipcMain.on('deplier', () => {
    epingle = true
    desarmerRetrait()
    void poserForme('barre')
  })

  ipcMain.handle('forme', () => forme)

  // La souris entre sur l'orbe de la pastille, ou en sort.
  ipcMain.on('survol', (_, dessus: boolean) => {
    if (forme !== 'pastille') return
    overlay?.setIgnoreMouseEvents(!dessus, { forward: true })
  })

  /**
   * Le modèle de la veille, lu ici et passé au renderer.
   *
   * Le worker de Vosk réclame une URL, et seule une URL d'objet créée dans le
   * renderer se lit aussi bien en développement qu'une fois l'application
   * empaquetée — là où un chemin de fichier et un protocole maison butent
   * chacun sur un cas.
   */
  ipcMain.handle('modele-veille', () => {
    try {
      return fs.readFileSync(join(assetsDir, 'veille', 'vosk-fr.tar.gz'))
    } catch {
      // Modèle absent : la veille se taira, le raccourci reste.
      return null
    }
  })

  // Le mot a été entendu : c'est le même geste que le raccourci.
  ipcMain.on('mot-entendu', () => {
    noter(`mot « Iris » entendu (état ${etat})`)
    // Appelée pendant qu'elle parle : elle se tait et écoute. Le raccourci,
    // lui, la coupe seulement ; son nom veut dire « écoute-moi ».
    if (etat === 'parole') {
      abandonnerTour()
      void ecouter('demande')
      return
    }
    void basculer()
  })

  // Ce que l'overlay veut consigner : la veille, le micro, la lecture.
  ipcMain.on('noter', (_, ligne: string) => noter(`overlay : ${ligne}`))

  /**
   * Le micro choisi n'existe plus (débranché, identifiant périmé d'une session
   * à l'autre). On l'oublie : sans ça, le repli sur le micro par défaut se
   * rejouait à chaque écoute, et les paramètres affichaient encore un
   * périphérique qui n'était plus écouté.
   */
  ipcMain.on('micro-perdu', () => {
    if (!reglages.peripherique) return
    reglages = { ...reglages, peripherique: '' }
    enregistrerReglages(reglages)
    diffuser('reglages', reglages)
    noter('micro choisi oublié : on reste sur celui par défaut')
  })
  ipcMain.on('nouvelle-conversation', repartirDeZero)

  // Les réglages en cours d'édition, pas ceux enregistrés : on veut entendre
  // la voix avant de valider.
  ipcMain.handle('tester-voix', async (_, recu: unknown) => {
    const mp3 = await (() => {
      const r = normalizeReglages(recu)
      return synthetiser(`Bonjour${r.prenom ? ` ${r.prenom}` : ''}, c'est Iris. Je t'écoute.`, r)
    })()
    return mp3.toString('base64')
  })

  /** Le carillon demandé, pour l'écouter dans les paramètres. */
  ipcMain.handle('lire-son', (_, nom: unknown) => {
    if (typeof nom !== 'string' || !/^[a-z]+$/.test(nom) || nom === 'aucun') return ''
    try {
      return fs.readFileSync(join(assetsDir, 'son', `${nom}.wav`)).toString('base64')
    } catch {
      return ''
    }
  })

  ipcMain.handle('choisir-dossier', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Dossier de travail d’Iris',
      defaultPath: reglages.dossier || app.getPath('documents'),
      properties: ['openDirectory']
    }
    const res = parametres
      ? await dialog.showOpenDialog(parametres, options)
      : await dialog.showOpenDialog(options)
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('comptes', () => cerveau.listerComptes(reglages))
  ipcMain.on('connecter-compte', (_, nom: string) => {
    noter(`connexion du compte ${nom}`)
    cerveau.connecterCompte(nom, reglages)
  })
  // ─── Écran de bienvenue ───────────────────────────────────────────────────

  ipcMain.handle('etat-claude', () => cerveau.etatClaude())
  ipcMain.on('preparer-claude', (_, quoi: unknown) => {
    if (quoi !== 'installer' && quoi !== 'connexion') return
    noter(`Claude Code : ${quoi}`)
    cerveau.preparerClaude(quoi)
  })

  /**
   * La clé est-elle bonne ? On interroge la liste des modèles du fournisseur :
   * c'est la requête la moins chère qui prouve la même chose qu'une
   * transcription, et elle ne demande pas de micro.
   */
  ipcMain.handle('tester-cle', async (_, recu: unknown) => {
    const r = normalizeReglages(recu)
    if (!r.cleApi) return { ok: false, erreur: 'Aucune clé.' }
    const url = FOURNISSEURS[r.fournisseur].endpoint.replace(/\/audio\/transcriptions$/, '/models')
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${r.cleApi}` } })
      if (res.ok) return { ok: true }
      if (res.status === 401) return { ok: false, erreur: 'Cette clé est refusée.' }
      return { ok: false, erreur: `Le service a répondu ${res.status}.` }
    } catch (err) {
      return { ok: false, erreur: `Service injoignable : ${String(err).slice(0, 80)}` }
    }
  })

  /** Fin du guide : les réglages sont déjà enregistrés, Iris se présente. */
  ipcMain.on('terminer-bienvenue', () => {
    bienvenue?.hide()
    if (!globalShortcut.isRegistered(reglages.raccourci)) enregistrerRaccourci(reglages.raccourci)
    void annoncer()
  })

  ipcMain.on('ouvrir-lien', (_, url: unknown) => {
    // Seules les adresses du guide, et seulement en clair sur le réseau.
    if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url)
  })

  /** Le bouton de la barre : accorder ou refuser l'accès sans parler. */
  ipcMain.on('repondre-autorisation', (_, oui: boolean) => {
    if (question?.genre !== 'autorisation') return
    overlay?.webContents.send('taire')
    terminerQuestion(oui ? 'oui' : 'non', oui ? 'bouton oui' : 'bouton non')
  })

  ipcMain.on('ouvrir-parametres', ouvrirParametres)
  ipcMain.on('ouvrir-conversation', ouvrirConversation)
})

// Relancer Iris alors qu'elle tourne déjà, c'est l'appeler.
app.on('second-instance', () => void basculer())

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  cerveau.fermerTout()
  fermerVoix()
})

// Toutes les fenêtres peuvent être fermées : l'application continue dans la
// zone de notification. Un gestionnaire vide suffit à empêcher l'arrêt.
app.on('window-all-closed', () => {})
