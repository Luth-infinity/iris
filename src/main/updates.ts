import { app, shell } from 'electron'
import type { AppUpdater } from 'electron-updater'

/**
 * Mise à jour interne.
 *
 * Le dépôt GitHub sert de flux : `electron-builder` y publie l'installeur et
 * un `latest.yml`, `electron-updater` lit ce fichier pour savoir si une
 * version plus récente existe. Sous Windows, on va jusqu'à l'installation.
 *
 * Sous macOS, l'installation sur place exige une application signée et
 * notariée par Apple, ce qu'Iris n'est pas : on se contente de lire la
 * dernière release et d'ouvrir sa page quand elle est plus récente.
 *
 * On ne télécharge ni n'installe jamais sans que quelqu'un l'ait demandé :
 * l'application se ferme pour installer, et elle est souvent en train de
 * servir dans une autre fenêtre.
 */

export type UpdateState =
  | { statut: 'inconnu' }
  | { statut: 'indisponible' } // développement : pas d'installeur à remplacer
  | { statut: 'verification' }
  | { statut: 'a-jour'; verifieLe: number }
  | { statut: 'disponible'; version: string; notes: string }
  | { statut: 'telechargement'; version: string; progres: number }
  | { statut: 'prete'; version: string }
  | { statut: 'erreur'; message: string }

const INTERVALLE = 2 * 60 * 60 * 1000
const PREMIER_DELAI = 20_000

let etat: UpdateState = { statut: 'inconnu' }
let ecouteurs: ((e: UpdateState) => void)[] = []
let updater: AppUpdater | null = null
/** macOS : la page de la release plus récente, ouverte au lieu d'installer. */
let pageMac = ''

const DERNIERE = 'https://api.github.com/repos/Luth-infinity/iris/releases/latest'

/** `0.2.10` > `0.2.9` : comparaison nombre par nombre, pas en texte. */
function plusRecente(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

async function verifierMac(): Promise<void> {
  poser({ statut: 'verification' })
  try {
    const res = await fetch(DERNIERE, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`)
    const r = (await res.json()) as { tag_name: string; html_url: string; body?: string }
    const version = r.tag_name.replace(/^v/, '')
    if (plusRecente(version, app.getVersion())) {
      pageMac = r.html_url
      poser({ statut: 'disponible', version, notes: String(r.body ?? '').slice(0, 400) })
    } else {
      poser({ statut: 'a-jour', verifieLe: Date.now() })
    }
  } catch (err) {
    poser({ statut: 'erreur', message: String((err as Error)?.message || err).slice(0, 200) })
  }
}

function poser(nouvel: UpdateState): void {
  etat = nouvel
  ecouteurs.forEach((cb) => cb(etat))
}

export function currentState(): UpdateState {
  return etat
}

export function onChange(cb: (e: UpdateState) => void): () => void {
  ecouteurs.push(cb)
  return () => {
    ecouteurs = ecouteurs.filter((x) => x !== cb)
  }
}

/**
 * `electron-updater` n'a de sens qu'empaqueté : hors installation il n'y a pas
 * d'`app-update.yml`, et il lève une exception au premier appel. On le charge
 * donc à la demande plutôt qu'en tête de fichier.
 */
function chargerUpdater(): AppUpdater | null {
  if (!app.isPackaged || process.platform !== 'win32') return null
  if (updater) return updater

  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info) => {
    poser({
      statut: 'disponible',
      version: info.version,
      notes: String(info.releaseNotes || '')
        .replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 400)
    })
  })
  autoUpdater.on('update-not-available', () => poser({ statut: 'a-jour', verifieLe: Date.now() }))
  autoUpdater.on('download-progress', (p) => {
    const version = 'version' in etat ? etat.version : ''
    poser({ statut: 'telechargement', version, progres: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => poser({ statut: 'prete', version: info.version }))
  autoUpdater.on('error', (err) =>
    poser({ statut: 'erreur', message: String(err?.message || err).slice(0, 200) })
  )

  updater = autoUpdater
  return updater
}

export async function verifier(): Promise<UpdateState> {
  if (app.isPackaged && process.platform === 'darwin') {
    await verifierMac()
    return etat
  }
  const up = chargerUpdater()
  if (!up) {
    poser({ statut: 'indisponible' })
    return etat
  }
  // Un téléchargement en cours ou terminé ne se re-vérifie pas : on écraserait
  // un état plus avancé par un « à jour » trompeur.
  if (etat.statut === 'telechargement' || etat.statut === 'prete') return etat

  poser({ statut: 'verification' })
  try {
    await up.checkForUpdates()
  } catch (err) {
    poser({ statut: 'erreur', message: String((err as Error)?.message || err).slice(0, 200) })
  }
  return etat
}

export async function telecharger(): Promise<void> {
  // macOS : on télécharge le nouveau .dmg à la main, depuis la release.
  if (process.platform === 'darwin') {
    if (pageMac) void shell.openExternal(pageMac)
    return
  }
  const up = chargerUpdater()
  if (!up || etat.statut !== 'disponible') return
  poser({ statut: 'telechargement', version: etat.version, progres: 0 })
  try {
    await up.downloadUpdate()
  } catch (err) {
    poser({ statut: 'erreur', message: String((err as Error)?.message || err).slice(0, 200) })
  }
}

/** Ferme l'application et lance l'installeur déjà téléchargé. */
export function installer(): void {
  const up = chargerUpdater()
  if (!up || etat.statut !== 'prete') return
  // `isSilent` : l'installeur NSIS est en un clic, personne n'a rien à
  // répondre. `isForceRunAfter` : l'application doit revenir dans le tray.
  up.quitAndInstall(true, true)
}

/** Vérifie au démarrage puis régulièrement — l'app reste ouverte des jours. */
export function surveiller(): void {
  if (!app.isPackaged || (process.platform !== 'win32' && process.platform !== 'darwin')) {
    poser({ statut: 'indisponible' })
    return
  }
  const premier = setTimeout(() => {
    void verifier()
    const boucle = setInterval(() => void verifier(), INTERVALLE)
    boucle.unref?.()
  }, PREMIER_DELAI)
  premier.unref?.()
}
