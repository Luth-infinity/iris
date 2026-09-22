import { contextBridge, ipcRenderer } from 'electron'
import type { Reglages } from '../shared/reglages'
import type { Etat, EvenementTour, Forme, ModeEcoute, Tour } from '../shared/conversation'

/** Abonnement à un canal sans argument, avec sa fonction de retrait. */
function ecouter(canal: string, cb: () => void): () => void {
  const handler = (): void => cb()
  ipcRenderer.on(canal, handler)
  return () => ipcRenderer.removeListener(canal, handler)
}

/** Abonnement à un canal qui porte une valeur. */
function recevoir<T>(canal: string, cb: (valeur: T) => void): () => void {
  const handler = (_e: unknown, valeur: T): void => cb(valeur)
  ipcRenderer.on(canal, handler)
  return () => ipcRenderer.removeListener(canal, handler)
}

const api = {
  plateforme: process.platform as NodeJS.Platform,

  reglages: (): Promise<Reglages> => ipcRenderer.invoke('reglages'),
  enregistrerReglages: (r: Reglages): Promise<{ ok: boolean; erreur?: string }> =>
    ipcRenderer.invoke('enregistrer-reglages', r),

  etat: (): Promise<Etat> => ipcRenderer.invoke('etat'),
  tours: (): Promise<Tour[]> => ipcRenderer.invoke('tours'),
  version: (): Promise<string> => ipcRenderer.invoke('version'),

  // ─── Overlay ──────────────────────────────────────────────────────────────

  /** Les réglages accompagnent l'ordre : le renderer n'a pas à les demander. */
  /** Le mode dit ce qu'on recueille : une demande, une suite, un oui ou un non. */
  surDemarrerEcoute: (cb: (r: Reglages, mode: ModeEcoute) => void) => {
    const handler = (_e: unknown, r: Reglages, mode?: string): void =>
      cb(r, mode === 'suite' || mode === 'confirmation' || mode === 'question' ? mode : 'demande')
    ipcRenderer.on('demarrer-ecoute', handler)
    return () => ipcRenderer.removeListener('demarrer-ecoute', handler)
  },
  /** La question posée par Iris, ou `null` quand elle est tranchée. */
  surConfirmation: (
    cb: (demande: { texte: string; genre: 'precision' | 'autorisation' } | null) => void
  ) => recevoir<{ texte: string; genre: 'precision' | 'autorisation' } | null>('confirmation', cb),
  /** Le bouton d'autorisation de la barre : oui ou non, sans parler. */
  repondreAutorisation: (oui: boolean): void => ipcRenderer.send('repondre-autorisation', oui),
  surArreterEcoute: (cb: () => void) => ecouter('arreter-ecoute', cb),
  /** Coupe la lecture en cours et vide la file. */
  surTaire: (cb: () => void) => ecouter('taire', cb),
  /** Plus aucune phrase ne viendra : si la lecture dort déjà, la réponse est finie. */
  surSynthesesFinies: (cb: () => void) => ecouter('syntheses-finies', cb),
  /** Elle arrive à l'écran, ou elle s'en va : de quoi jouer l'animation. */
  surApparition: (cb: () => void) => ecouter('apparition', cb),
  surDisparition: (cb: () => void) => ecouter('disparition', cb),
  /** Phrase affichée au repos, au démarrage : comment appeler Iris. */
  surAnnonce: (cb: (texte: string) => void) => recevoir<string>('annonce', cb),
  /** Le carillon du lancement, en base64 : hors de la file de la voix. */
  surSon: (cb: (base64: string) => void) => recevoir<string>('son', cb),
  /** Un MP3 en base64, à jouer dans l'ordre d'arrivée. */
  surAudio: (cb: (base64: string) => void) => recevoir<string>('audio', cb),

  /** Les octets du modèle de veille, ou `null` s'il manque. */
  modeleVeille: (): Promise<Uint8Array | null> => ipcRenderer.invoke('modele-veille'),
  /** Le micro enregistré n'existe plus : Iris l'oublie. */
  microPerdu: (): void => ipcRenderer.send('micro-perdu'),
  /** Une ligne pour `journal.log`, côté main. */
  noter: (ligne: string): void => ipcRenderer.send('noter', ligne),
  /** Le mot « Iris » vient d'être prononcé. */
  motEntendu: (): void => ipcRenderer.send('mot-entendu'),

  transcription: (): void => ipcRenderer.send('transcription'),
  question: (texte: string): void => ipcRenderer.send('question', texte),
  ecouteAnnulee: (): void => ipcRenderer.send('ecoute-annulee'),
  ecouteErreur: (message: string): void => ipcRenderer.send('ecoute-erreur', message),
  paroleFinie: (): void => ipcRenderer.send('parole-finie'),

  // ─── Conversation ─────────────────────────────────────────────────────────

  surEtat: (cb: (etat: Etat) => void) => recevoir<Etat>('etat', cb),
  /** Les réglages viennent d'être enregistrés ailleurs. */
  surReglages: (cb: (r: Reglages) => void) => recevoir<Reglages>('reglages', cb),
  surTour: (cb: (tour: Tour) => void) => recevoir<Tour>('tour', cb),
  surEvenement: (cb: (e: EvenementTour) => void) => recevoir<EvenementTour>('evenement', cb),
  surErreur: (cb: (message: string) => void) => recevoir<string>('erreur', cb),
  surFilVide: (cb: () => void) => ecouter('fil-vide', cb),

  /** Le même geste que le raccourci : ouvre le micro, valide, ou coupe. */
  basculer: (): void => ipcRenderer.send('basculer'),
  /** Tout arrêter et masquer la barre, sans rien relancer. */
  congedier: (): void => ipcRenderer.send('congedier'),
  /** Depuis la pastille : ramener Iris en face, et l'y garder. */
  deplier: (): void => ipcRenderer.send('deplier'),

  forme: (): Promise<Forme> => ipcRenderer.invoke('forme'),
  /** La souris est sur quelque chose de cliquable dans la pastille, ou non. */
  survol: (dessus: boolean): void => ipcRenderer.send('survol', dessus),
  /** La fenêtre va changer de taille : jouer la sortie. */
  surFormePart: (cb: () => void) => ecouter('forme-part', cb),
  surForme: (cb: (forme: Forme) => void) => recevoir<Forme>('forme', cb),
  nouvelleConversation: (): void => ipcRenderer.send('nouvelle-conversation'),
  ouvrirParametres: (): void => ipcRenderer.send('ouvrir-parametres'),
  ouvrirConversation: (): void => ipcRenderer.send('ouvrir-conversation'),

  // ─── Paramètres ───────────────────────────────────────────────────────────

  /** La fenêtre vient d'être montrée : moment choisi pour lister les micros. */
  surParametresAffiches: (cb: () => void) => ecouter('parametres-affiches', cb),

  /** Synthétise une phrase d'exemple avec les réglages en cours d'édition. */
  testerVoix: (r: Reglages): Promise<string> => ipcRenderer.invoke('tester-voix', r),
  /** Un carillon en base64, pour l'écouter avant de le choisir. */
  lireSon: (nom: string): Promise<string> => ipcRenderer.invoke('lire-son', nom),
  choisirDossier: (): Promise<string | null> => ipcRenderer.invoke('choisir-dossier'),

  // ─── Écran de bienvenue ───────────────────────────────────────────────────

  /** Claude Code est-il installé sur cette machine, et connecté ? */
  etatClaude: (): Promise<{ installe: boolean; version: string; connecte: boolean | null }> =>
    ipcRenderer.invoke('etat-claude'),
  /** Ouvre un terminal qui installe Claude Code, ou l'y connecte. */
  preparerClaude: (quoi: 'installer' | 'connexion'): void =>
    ipcRenderer.send('preparer-claude', quoi),
  /** Vérifie la clé de transcription auprès du fournisseur. */
  testerCle: (r: Reglages): Promise<{ ok: boolean; erreur?: string }> =>
    ipcRenderer.invoke('tester-cle', r),
  terminerBienvenue: (): void => ipcRenderer.send('terminer-bienvenue'),
  ouvrirLien: (url: string): void => ipcRenderer.send('ouvrir-lien', url),
  /** Les comptes Figma du Claude Code d'Iris, et s'ils sont connectés. */
  comptes: (): Promise<{ nom: string; connecte: boolean }[]> => ipcRenderer.invoke('comptes'),
  /** Ouvre la connexion d'un compte : terminal, puis Firefox en navigation privée. */
  connecterCompte: (nom: string): void => ipcRenderer.send('connecter-compte', nom)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

declare global {
  interface Window {
    api: Api
  }
}
