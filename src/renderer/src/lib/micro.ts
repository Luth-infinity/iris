import { FOURNISSEURS, type Reglages } from '@shared/reglages'

/**
 * Tout ce qui touche au micro et à la transcription, sorti de la page pour
 * qu'elle ne raconte plus que l'enchaînement des états. Le code vient de
 * VoiceType, où il a été éprouvé.
 */

export type Souci = {
  titre: string
  detail?: string
  /** Les réglages sont la seule issue : on propose d'y aller. */
  reglages?: boolean
}

export class ErreurMicro extends Error {
  constructor(readonly souci: Souci) {
    super(souci.titre)
  }
}

/**
 * Ouvre le micro choisi, ou celui du système s'il a disparu.
 *
 * Les identifiants de périphérique changent d'une session à l'autre : celui
 * enregistré dans les réglages ne désignait parfois plus rien, et la veille
 * comme l'écoute échouaient en silence alors qu'un micro marchait très bien.
 * Retomber sur le micro par défaut vaut mieux que ne plus entendre du tout.
 */
export async function flux(
  peripherique: string,
  options: MediaTrackConstraints = {},
  surRepli?: () => void
): Promise<MediaStream> {
  if (peripherique) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...options, deviceId: { exact: peripherique } }
      })
    } catch (err) {
      const nom = String((err as Error)?.name || '')
      if (nom !== 'OverconstrainedError' && nom !== 'NotFoundError') throw err
      surRepli?.()
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: Object.keys(options).length ? options : true
  })
}

/** Ouvre le flux, en traduisant les échecs de Chromium en français lisible. */
export async function ouvrirMicro(
  reglages: Reglages,
  surRepli?: () => void
): Promise<MediaStream> {
  try {
    return await flux(reglages.peripherique, {}, surRepli)
  } catch (err) {
    const nom = String((err as Error)?.name || '')
    if (nom === 'OverconstrainedError' || nom === 'NotFoundError') {
      // Même le micro par défaut manque : il n'y a plus de micro du tout.
      throw new ErreurMicro({
        titre: 'Aucun microphone',
        detail: 'Branchez un micro, ou choisissez-en un dans les paramètres.',
        reglages: true
      })
    }
    if (nom === 'NotAllowedError') {
      throw new ErreurMicro({
        titre: 'Accès au micro refusé',
        detail: 'Windows → Confidentialité → Microphone.'
      })
    }
    throw new ErreurMicro({ titre: 'Micro indisponible', detail: nom })
  }
}

/**
 * Ouvre un analyseur sur le flux du micro.
 *
 * On rend l'analyseur brut, pas des niveaux déjà calculés : c'est l'anneau qui
 * mène la boucle d'animation, et il a besoin du spectre complet. Un seul
 * `requestAnimationFrame` pour tout l'écran, plutôt qu'un par source.
 */
export function ouvrirAnalyseur(stream: MediaStream): {
  analyseur: AnalyserNode
  arreter: () => void
} {
  const ctx = new AudioContext()
  const analyseur = ctx.createAnalyser()
  analyseur.fftSize = 1024
  analyseur.smoothingTimeConstant = 0.72
  ctx.createMediaStreamSource(stream).connect(analyseur)
  return {
    analyseur,
    arreter: () => void ctx.close().catch(() => {})
  }
}

/** Envoie l'audio au service de transcription et rend le texte reconnu. */
export async function transcrire(
  blob: Blob,
  reglages: Reglages,
  signal: AbortSignal
): Promise<string> {
  const fournisseur = FOURNISSEURS[reglages.fournisseur]
  const corps = new FormData()
  corps.append('file', blob, 'question.webm')
  corps.append('model', fournisseur.modele)
  corps.append('language', reglages.langue)

  const res = await fetch(fournisseur.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${reglages.cleApi}` },
    body: corps,
    signal
  })

  if (!res.ok) {
    const brut = await res.text().catch(() => '')
    let detail = brut.slice(0, 160)
    try {
      detail = JSON.parse(brut)?.error?.message ?? detail
    } catch {
      // Réponse non JSON (page d'erreur d'un proxy) : on garde le brut.
    }
    throw new ErreurMicro({
      titre:
        res.status === 401
          ? 'Clé de transcription refusée'
          : res.status === 429
            ? 'Quota atteint — réessayez dans un instant'
            : `Erreur ${res.status}`,
      detail,
      reglages: res.status === 401
    })
  }

  return String((await res.json())?.text ?? '').trim()
}

/**
 * Réveille la pile audio sans ouvrir le micro.
 *
 * Le service audio de Chromium ne démarre qu'à la première utilisation, et ce
 * démarrage tombait au pire moment : entre le raccourci et la barre. Un
 * contexte suspendu suffit à le lancer, et n'allume aucun témoin.
 */
export function prechaufferAudio(): () => void {
  let ctx: AudioContext | null = null
  try {
    ctx = new AudioContext()
    void ctx.suspend()
    void navigator.mediaDevices.enumerateDevices()
  } catch {
    // Pile audio indisponible : l'écoute s'en chargera le moment venu.
  }
  return () => void ctx?.close().catch(() => {})
}
