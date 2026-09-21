import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'

/**
 * Mise à jour interne.
 *
 * Le dépôt GitHub sert de flux : `electron-builder` y publie l'installeur et
 * un `latest.yml`, `electron-updater` lit ce fichier pour savoir si une
 * version plus récente existe. Iris n’existant que sous Windows, on peut
 * aller jusqu'à l'installation — pas de signature Apple à obtenir.
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
  if (!app.isPackaged || process.platform !== 'win32') {
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
