/**
 * Les mots qui pilotent l'écoute à la voix.
 *
 * Séparés de `veille.ts` : ce module-là est chargé à la demande parce qu'il
 * tire Vosk et son WASM. L'overlay, qui s'en sert aussi pour nettoyer la
 * transcription, ne doit pas les embarquer pour autant.
 */

/**
 * Fins de phrase qui disent « j'ai fini ». Elles ne comptent qu'en **fin**
 * d'énoncé : « c'est bon pour le fichier ? » n'envoie rien.
 */
export const FINS_ENVOI = ["c'est bon", "c'est tout", 'merci']
// « Vas-y » n'en fait pas partie : en réponse à « Tu veux que je l'ouvre ? »,
// c'est un oui, et le retirer laissait une demande vide, donc une annulation.

/**
 * Énoncés qui annulent. Ils doivent être **seuls** : « arrête le serveur » est
 * une demande, pas une annulation.
 */
export const ANNULATIONS = [
  'stop',
  'annule',
  'laisse tomber',
  'arrête',
  'non rien',
  'rien',
  'oublie',
  'non merci',
  // Les refus qui ferment une conversation, quand Iris vient de proposer
  // une suite.
  'non',
  'non ça ira',
  'non ça va',
  "non c'est bon",
  "c'est bon merci"
  // Pas « ça va » ni « ça ira » seuls : « Ça va ? » est une question, et
  // Iris se refermait sans y répondre.
]

/**
 * Les mots d'un contentement : « c'est parfait, merci », « nickel », « ok
 * super ». Dits après une réponse, ils closent l'échange — ce ne sont pas des
 * demandes.
 *
 * Il faut qu'un **mot fort** y soit (on ne clôt pas sur un « oui » seul, qui
 * accepte souvent une proposition), et que toute la phrase tienne dans ce
 * vocabulaire : « parfait, maintenant ouvre-le » est une demande.
 */
const CONTENTEMENT_FORT = [
  'merci',
  'parfait',
  'nickel',
  'super',
  'top',
  'genial',
  'geniale',
  'cool',
  'impeccable',
  'impec',
  'bravo',
  'excellent',
  'excellente',
  'magnifique',
  'niquel'
]

const CONTENTEMENT_LIANT = [
  "c'est",
  'cest',
  'ca',
  'c',
  'est',
  'tres',
  'bien',
  'beaucoup',
  'ok',
  'okay',
  'oui',
  'voila',
  'joue',
  'marche',
  'roule',
  'me',
  'va',
  'la',
  'le',
  'et',
  'du',
  'coup',
  'alors',
  'donc',
  'bon',
  'tout',
  'mille'
]

/**
 * Cette phrase ne demande rien : elle remercie ou approuve.
 *
 * Sans ça, « c'est parfait, merci » repartait à l'agent, qui répondait par un
 * pouce levé et rouvrait le micro : il fallait parler encore pour en sortir.
 */
export function estCloture(brut: string): boolean {
  const plat = aplatir(brut)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'")
  if (!plat) return false
  // Une question n'est jamais une clôture : « c'est bon ? » attend une réponse.
  if (/\?\s*$/.test(brut.trim())) return false

  const mots = plat.split(/[\s']+/).filter(Boolean)
  if (!mots.length || mots.length > 7) return false
  if (!mots.some((m) => CONTENTEMENT_FORT.includes(m))) return false
  return mots.every((m) => CONTENTEMENT_FORT.includes(m) || CONTENTEMENT_LIANT.includes(m))
}

/** Minuscules, sans ponctuation, espaces simples : la forme qu'on compare. */
export function aplatir(texte: string): string {
  return texte
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,!?;:«»"…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Prépare la transcription d'une demande avant de l'envoyer à l'agent.
 *
 * Rend `null` pour une annulation, et retire le « c'est bon » final qui a
 * servi à clore la demande : l'agent le prendrait pour une partie de la
 * question.
 */
export function lireDemande(brut: string): string | null {
  const plat = aplatir(brut)
  if (!plat) return null
  // Une question reste une question, même courte : « Non ? », « Rien ? »
  // n'annulent rien, et on n'en retire aucune formule.
  if (/\?\s*$/.test(brut.trim())) return brut.trim()
  if (ANNULATIONS.includes(plat)) return null

  let texte = brut.trim()
  for (const fin of FINS_ENVOI) {
    // Insensible à la casse et à l'apostrophe typographique, et la
    // ponctuation qui suit la formule part avec elle.
    const motif = new RegExp(`[\\s,.;:!?-]*${fin.replace(/'/g, "['’]")}[\\s.!?…]*$`, 'i')
    if (motif.test(texte)) {
      texte = texte.replace(motif, '').trim()
      break
    }
  }
  return texte || null
}
