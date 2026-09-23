/**
 * Source unique des réglages : le main les persiste, le preload les fait
 * transiter, le renderer les édite. Sur VoiceType, les trois process avaient
 * chacun leur copie du type et elles ont fini par diverger — toute évolution
 * passe donc par ce fichier et par `normalizeReglages()`.
 */

export type Fournisseur = 'groq' | 'openai'

export type Ton = 'pose' | 'naturel' | 'enjoue'

/**
 * Les tons proposés, par la hauteur de la voix.
 *
 * L'endpoint gratuit d'Edge refuse le style « cheerful » des voix Azure (la
 * synthèse est coupée net, vérifié) : la hauteur est le seul levier d'humeur
 * qui passe. Un peu plus haut se perçoit comme plus gai ; au-delà de +8 %, la
 * voix sonne fausse.
 */
export const TONS: Record<Ton, { label: string; hauteur: string }> = {
  enjoue: { label: 'Enjoué', hauteur: '+6%' },
  naturel: { label: 'Naturel', hauteur: '+0%' },
  pose: { label: 'Posé', hauteur: '-3%' }
}

/**
 * Les gammes de couleur.
 *
 * Une seule teinte change dans toute l'application : la couleur des états
 * vivants (l'anneau, l'orbe, les accents). Les surfaces restent neutres, sinon
 * l'application entière se teinte. `chroma` corrige la saturation là où une
 * teinte paraîtrait fade ou criarde à intensité égale.
 */
export type Couleur = 'iris' | 'ocean' | 'menthe' | 'ambre' | 'rose' | 'argent'

export const COULEURS: Record<Couleur, { label: string; teinte: number; chroma: number }> = {
  iris: { label: 'Iris', teinte: 276, chroma: 1 },
  ocean: { label: 'Océan', teinte: 243, chroma: 1 },
  menthe: { label: 'Menthe', teinte: 164, chroma: 0.95 },
  ambre: { label: 'Ambre', teinte: 74, chroma: 1.05 },
  rose: { label: 'Rose', teinte: 352, chroma: 1 },
  argent: { label: 'Argent', teinte: 265, chroma: 0.14 }
}

/**
 * Le son du démarrage : trois carillons de synthèse (voir `son/generer.mjs`),
 * ou rien. Il ne se joue qu'au lancement, jamais pendant le travail.
 */
export type SonDemarrage = 'iris' | 'souffle' | 'cristal' | 'aucun'

export const SONS: Record<SonDemarrage, string> = {
  iris: 'Iris — trois notes qui montent',
  souffle: 'Souffle — deux notes tenues',
  cristal: 'Cristal — quatre notes brèves',
  aucun: 'Aucun'
}

/** Ce que l'agent est autorisé à faire sans que personne ne puisse répondre. */
export type Permission = 'lecture' | 'edition' | 'total'

export type Reglages = {
  /** Version du format, pour les migrations de `normalizeReglages`. */
  version: number
  /** Raccourci global : une pression ouvre le micro, la suivante valide. */
  raccourci: string
  fournisseur: Fournisseur
  cleApi: string
  /** Code de langue à deux lettres ('fr'), pas une étiquette régionale. */
  langue: string
  /** '' = microphone par défaut du système. */
  peripherique: string
  /** Voix de synthèse (`ShortName` Microsoft). */
  voix: string
  /** Débit de la voix, en pourcentage relatif ('+0%', '+12%'…). */
  debit: string
  /** Couleur de la voix : la hauteur, seul réglage d'humeur que l'endpoint gratuit accepte. */
  ton: Ton
  /** Lire les réponses à voix haute. Décoché, Iris reste une fenêtre. */
  parler: boolean
  /** Réveil au mot « Iris » : micro ouvert en continu, reconnaissance locale. */
  veille: boolean
  /** Après une réponse, le micro se rouvre quelques secondes pour enchaîner. */
  suite: boolean
  /**
   * `auto` : chaque demande est triée et part au modèle qui lui convient.
   * Sinon, un alias imposé à tout (`opus`, `sonnet`, `haiku`).
   */
  modele: string
  /** Dossier de travail de l'agent : il ne voit rien au-dessus. */
  dossier: string
  permission: Permission
  /** Le prénom qu'Iris donne à la personne qui lui parle. '' : elle n'en dit pas. */
  prenom: string
  /**
   * Accès à tout le dossier de l'utilisateur, et pas seulement au dossier de
   * travail et aux dossiers usuels.
   */
  etendu: boolean
  /** Lancer Iris à l'ouverture de session. */
  demarrageAuto: boolean
  /** La gamme de couleur des états vivants. */
  couleur: Couleur
  /** Le carillon joué au lancement. */
  sonDemarrage: SonDemarrage
}

/**
 * Version courante du format.
 *
 * 2 : le réveil au mot « Iris » passe à coché. Les fichiers antérieurs le
 * portaient à `false` parce que c'était le défaut, pas un choix : on le
 * rallume une fois, et on respecte ensuite ce qui est décoché.
 *
 * 3 : le modèle passe en `auto`. Même raison : `sonnet` était le défaut
 * d'alors, pas un choix.
 *
 * 4 : le prénom devient un réglage. Il était écrit en dur (« Lucas ») avant
 * la première version publiée : les seuls fichiers antérieurs sont les siens,
 * ils le gardent.
 *
 * 5 : la gamme de couleur et le son de démarrage s'ajoutent. Rien à migrer,
 * leurs défauts sont ceux d'avant : le violet, et le carillon d'Iris.
 *
 * 6 : l'accès étendu s'ajoute, décoché. On ne l'accorde jamais sans être
 * demandé — c'est tout l'intérêt du bouton d'autorisation.
 *
 * 7 : le démarrage automatique s'ajoute, décoché. Une assistante qu'il faut
 * penser à lancer ne sert à rien, mais c'est à chacun de le décider.
 */
const VERSION = 7

export const REGLAGES_DEFAUT: Reglages = {
  version: VERSION,
  // Alt + une seule lettre est avalé par les menus des autres applications,
  // et Alt+Espace ouvre le menu système de la fenêtre active.
  raccourci: 'Ctrl+Shift+Space',
  fournisseur: 'groq',
  cleApi: '',
  langue: 'fr',
  peripherique: '',
  // Voix « multilingue » : c'est la seule famille qui prononce correctement
  // les mots anglais semés dans une phrase française (Figma, GitHub, Vercel).
  voix: 'fr-FR-VivienneMultilingualNeural',
  debit: '+8%',
  ton: 'enjoue',
  parler: true,
  // Coché : c'est la façon d'appeler Iris. Laissé décoché au départ, le
  // réveil n'avait jamais été activé et « Iris » ne répondait à rien.
  veille: true,
  suite: true,
  modele: 'auto',
  dossier: '',
  permission: 'edition',
  prenom: '',
  etendu: false,
  demarrageAuto: false,
  couleur: 'iris',
  sonDemarrage: 'iris'
}

/**
 * Les deux fournisseurs de transcription parlent le même dialecte (l'API audio
 * d'OpenAI), mais **pas** avec les mêmes modèles : `whisper-large-v3-turbo`
 * n'existe que chez Groq, et OpenAI répond 400 si on le lui demande.
 */
export const FOURNISSEURS: Record<
  Fournisseur,
  { label: string; modele: string; endpoint: string; prefixe: string; url: string; aide: string }
> = {
  groq: {
    label: 'Groq — Whisper large v3 turbo',
    modele: 'whisper-large-v3-turbo',
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    prefixe: 'gsk_',
    url: 'https://console.groq.com/keys',
    aide: 'Compte gratuit sur console.groq.com → API Keys.'
  },
  openai: {
    label: 'OpenAI — Whisper',
    modele: 'whisper-1',
    endpoint: 'https://api.openai.com/v1/audio/transcriptions',
    prefixe: 'sk-',
    url: 'https://platform.openai.com/api-keys',
    aide: 'Compte OpenAI approvisionné en crédits.'
  }
}

/** Voix françaises de l'endpoint Edge, gratuites et sans clé. */
export const VOIX = [
  { value: 'fr-FR-VivienneMultilingualNeural', label: 'Vivienne — multilingue' },
  { value: 'fr-FR-RemyMultilingualNeural', label: 'Rémy — multilingue' },
  { value: 'fr-FR-DeniseNeural', label: 'Denise' },
  { value: 'fr-FR-EloiseNeural', label: 'Éloïse' },
  { value: 'fr-FR-HenriNeural', label: 'Henri' },
  { value: 'fr-CA-SylvieNeural', label: 'Sylvie — Québec' },
  { value: 'fr-CH-ArianeNeural', label: 'Ariane — Suisse' }
] as const

/**
 * Modèles proposés. Ce sont des alias, résolus par Claude Code au lancement :
 * écrire un identifiant complet le fige sur une version qui sera retirée.
 */
export const MODELES = [
  { value: 'auto', label: 'Automatique — selon la demande' },
  { value: 'sonnet', label: 'Sonnet — le bon compromis' },
  { value: 'opus', label: 'Opus — le plus capable' },
  { value: 'haiku', label: 'Haiku — le plus rapide' }
] as const

export const PERMISSIONS: Record<Permission, { label: string; aide: string; mode: string }> = {
  lecture: {
    label: 'Lecture seule',
    aide: 'Iris lit vos fichiers et répond. Elle ne modifie rien.',
    mode: 'default'
  },
  edition: {
    label: 'Écriture seulement',
    aide: 'Elle crée et modifie des fichiers, mais ne peut rien lancer : installer une application ou changer un réglage du PC lui sera refusé.',
    mode: 'acceptEdits'
  },
  total: {
    // L'ancien libellé disait « sans confirmation », ce qui n'est plus vrai
    // depuis le garde : supprimer, publier ou envoyer se font toujours
    // confirmer à la voix.
    label: 'Tout faire sur cet ordinateur',
    aide: "Commandes comprises : installer, régler, lancer. Ce qui ne se rattrape pas — supprimer, publier, envoyer — vous est toujours demandé avant.",
    mode: 'bypassPermissions'
  }
}

export const LANGUES = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' }
] as const

/**
 * Ramène n'importe quel contenu de `reglages.json` à la forme courante : le
 * fichier survit aux versions, donc il contient des clés disparues et parfois
 * des valeurs devenues invalides (une langue `fr-FR` que la liste déroulante
 * ne sait plus sélectionner, par exemple).
 */
export function normalizeReglages(brut: unknown): Reglages {
  const r = (brut ?? {}) as Partial<Record<keyof Reglages, unknown>>
  const texte = (v: unknown, defaut: string): string =>
    typeof v === 'string' && v.trim() ? v : defaut

  const langue = texte(r.langue, REGLAGES_DEFAUT.langue).split(/[-_]/)[0].toLowerCase()
  const permission = r.permission
  const voix = texte(r.voix, REGLAGES_DEFAUT.voix)
  const version = typeof r.version === 'number' ? r.version : 1

  return {
    version: VERSION,
    raccourci: texte(r.raccourci, REGLAGES_DEFAUT.raccourci),
    fournisseur: r.fournisseur === 'openai' ? 'openai' : 'groq',
    cleApi: typeof r.cleApi === 'string' ? r.cleApi : '',
    langue: LANGUES.some((l) => l.value === langue) ? langue : REGLAGES_DEFAUT.langue,
    // 'default' est l'identifiant que Chromium donne au micro système : on le
    // ramène à '' pour ne pas le contraindre nommément, il change de session.
    peripherique:
      typeof r.peripherique === 'string' && r.peripherique !== 'default' ? r.peripherique : '',
    // Une voix absente de la liste reste acceptée : l'endpoint en propose des
    // centaines, la liste déroulante n'est qu'un raccourci vers les utiles.
    voix,
    debit: texte(r.debit, REGLAGES_DEFAUT.debit),
    ton: r.ton === 'pose' || r.ton === 'naturel' || r.ton === 'enjoue' ? r.ton : REGLAGES_DEFAUT.ton,
    parler: typeof r.parler === 'boolean' ? r.parler : REGLAGES_DEFAUT.parler,
    veille:
      version < 2 || typeof r.veille !== 'boolean' ? REGLAGES_DEFAUT.veille : r.veille,
    suite: typeof r.suite === 'boolean' ? r.suite : REGLAGES_DEFAUT.suite,
    modele: version < 3 ? REGLAGES_DEFAUT.modele : texte(r.modele, REGLAGES_DEFAUT.modele),
    dossier: typeof r.dossier === 'string' ? r.dossier : '',
    permission:
      permission === 'lecture' || permission === 'total' || permission === 'edition'
        ? permission
        : REGLAGES_DEFAUT.permission,
    prenom:
      typeof r.prenom === 'string'
        ? r.prenom.trim().slice(0, 40)
        : brut && version < 4
          ? 'Lucas'
          : '',
    etendu: typeof r.etendu === 'boolean' ? r.etendu : REGLAGES_DEFAUT.etendu,
    demarrageAuto:
      typeof r.demarrageAuto === 'boolean' ? r.demarrageAuto : REGLAGES_DEFAUT.demarrageAuto,
    couleur:
      typeof r.couleur === 'string' && r.couleur in COULEURS
        ? (r.couleur as Couleur)
        : REGLAGES_DEFAUT.couleur,
    sonDemarrage:
      typeof r.sonDemarrage === 'string' && r.sonDemarrage in SONS
        ? (r.sonDemarrage as SonDemarrage)
        : REGLAGES_DEFAUT.sonDemarrage
  }
}
