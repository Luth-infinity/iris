import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { TONS, type Reglages } from '@shared/reglages'
import { dossiersUsuels } from './cerveau'

/**
 * La voix passe par l'endpoint de lecture à voix haute de Microsoft Edge :
 * gratuit, sans clé, et ses voix « multilingues » prononcent correctement les
 * mots anglais semés dans une phrase française. C'est ce point de coût qui
 * avait fait renoncer au projet, ElevenLabs étant hors de prix pour un usage
 * quotidien.
 *
 * On synthétise **phrase par phrase** : attendre la réponse entière avant de
 * parler ajoutait une seconde de silence à chaque échange.
 */

/** Une connexion par voix, gardée ouverte : la poignée de main coûte ~200 ms. */
let tts: MsEdgeTTS | null = null
let voixOuverte = ''

async function connexion(voix: string): Promise<MsEdgeTTS> {
  if (tts && voixOuverte === voix) return tts
  tts?.close()
  const suivant = new MsEdgeTTS()
  await suivant.setMetadata(voix, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  tts = suivant
  voixOuverte = voix
  return suivant
}

/** Le possessif qui va avec chaque dossier usuel, pour qu'une phrase tienne. */
const POSSESSIFS: Record<string, string> = {
  Téléchargements: 'tes Téléchargements',
  Bureau: 'ton Bureau',
  Documents: 'tes Documents',
  Images: 'tes Images',
  Musique: 'ta Musique',
  Vidéos: 'tes Vidéos'
}

/**
 * Remplace les chemins par ce qu'on dirait à voix haute.
 *
 * La consigne l'interdit déjà à l'agent, mais il lui arrive d'écrire un
 * chemin, surtout pour dire qu'il n'a pas accès à quelque chose : la voix
 * lisait alors « C deux points barre oblique Users barre oblique thoma ».
 * `…\Downloads\page.html` devient « page.html dans tes Téléchargements ».
 */
function parlerChemins(texte: string, dossierTravail: string): string {
  const reperes = [
    ...dossiersUsuels().map((d) => ({ chemin: d.chemin, dit: POSSESSIFS[d.nom] ?? d.nom })),
    ...(dossierTravail ? [{ chemin: dossierTravail, dit: 'tes projets' }] : [])
  ]
    .map((r) => ({ ...r, chemin: r.chemin.replace(/\//g, '\\').toLowerCase() }))
    // Le plus long d'abord : « Documents\Apps » doit passer avant « Documents ».
    .sort((a, b) => b.chemin.length - a.chemin.length)

  // Les accents graves et les étoiles arrêtent le chemin : un chemin écrit
  // en `code` garderait sinon son accent fermant, et le nettoyage du code ne
  // trouverait plus sa paire.
  // La lettre de lecteur doit être seule : dans « https:// », le « s: » n'en
  // est pas une.
  return texte.replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^\s"'«»,;!?()`*]*/g, (brut) => {
    // Le point qui clôt la phrase a été avalé avec le chemin : on le rend,
    // sinon la voix enchaîne deux phrases sans respirer.
    const fin = brut.match(/[.:]+$/)?.[0] ?? ''
    const chemin = brut.slice(0, brut.length - fin.length).replace(/\//g, '\\')
    const bas = chemin.toLowerCase()
    const repere = reperes.find((r) => bas === r.chemin || bas.startsWith(r.chemin + '\\'))
    const segments = chemin.split('\\').filter(Boolean)
    const dernier = segments[segments.length - 1] ?? ''
    if (!repere) return dernier + fin
    if (bas === repere.chemin) return repere.dit + fin
    // Dans les projets, le nom suffit : Lucas connaît les siens, et « dans
    // carnet dans tes projets » s'entend comme un bégaiement.
    if (repere.dit === 'tes projets') return dernier + fin
    return `${dernier} dans ${repere.dit}${fin}`
  })
}

/**
 * Enlève ce qui ne se prononce pas. La consigne demande déjà à l'agent
 * d'éviter listes et code, mais une réponse sur deux contient une étoile ou
 * un accent grave, et la voix lit « astérisque ».
 */
/**
 * Extensions qu'on ne prononce pas : « page.html » se dit « page ». La voix
 * lisait « page point h t m l ».
 */
const EXTENSIONS =
  'html?|css|scss|js|jsx|ts|tsx|mjs|cjs|json|md|txt|py|rs|go|java|cs|php|rb|sh|ps1|bat|exe|dll|log|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|webp|svg|ico|mp3|mp4|wav|zip|rar|7z|yml|yaml|toml|ini|env|lock'

/**
 * Rend un texte écrit prononçable.
 *
 * La consigne demande déjà à l'agent d'écrire pour l'oreille, mais il lui
 * échappe un smiley, un nom de fichier ou une adresse, et la voix les lit
 * tels quels : « visage souriant », « suite tiret essai point h t m l ».
 * Ce filtre rattrape ce qui reste, sans toucher au texte affiché.
 */
/**
 * Hébergeurs dont le nom ne dit rien : dans `iris-luth.vercel.app`, le site
 * s'appelle « iris luth », pas « vercel ».
 */
const HEBERGEURS = [
  'vercel.app',
  'github.io',
  'netlify.app',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'onrender.com',
  'notion.site'
]

/**
 * Le nom d'un site, tel qu'on le dit : « youtube », « ton site iris luth ».
 *
 * On garde l'étiquette qui porte le sens — celle d'avant le suffixe — et on
 * jette le reste. Dire l'adresse entière (« api point groq point com ») est
 * exactement ce qui fait bafouiller une voix de synthèse.
 */
function nomDeSite(hote: string): string {
  const bas = hote.toLowerCase().replace(/^www\./, '')
  const heberge = HEBERGEURS.find((h) => bas.endsWith('.' + h))
  // Sans hébergeur connu, on n'enlève que l'extension : tout retirer d'un coup
  // laissait « api » pour `api.groq.com`.
  const reste = heberge ? bas.slice(0, -(heberge.length + 1)) : bas.replace(/\.[a-z]{2,}$/, '')
  const etiquettes = reste.split('.').filter(Boolean)
  // Les sous-domaines de service ne se disent pas : personne n'a besoin
  // d'entendre « api » ni « www ».
  const utiles = etiquettes.filter((e) => e !== 'api' && e !== 'www')
  const nom = (utiles.length ? utiles : etiquettes).slice(-1)[0] ?? bas
  return nom.replace(/[-_]+/g, ' ')
}

export function pourLaVoix(brut: string, dossierTravail = ''): string {
  // Les adresses d'abord : « https://… » ressemble à un chemin (« s:/ »), et
  // le filtre des chemins en gardait le dernier morceau.
  const sansAdresses = brut
    // La ponctuation finale n'appartient pas à l'adresse : sans ce garde-fou,
    // le point de la phrase partait avec elle et la voix enchaînait.
    .replace(/https?:\/\/([a-z0-9.-]+)([^\s)»"']*[^\s)»"'.,;:!?])?/gi, (_m, hote: string) =>
      nomDeSite(hote)
    )
    // Une adresse mail se dit lettre à lettre nulle part : le nom suffit.
    .replace(
      /\b([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})\b/gi,
      (_m, qui: string, hote: string) => `${qui.replace(/[._%+-]+/g, ' ')} chez ${nomDeSite(hote)}`
    )
  return (
    parlerChemins(sansAdresses, dossierTravail)
      // Le code ne se dit pas : un bloc disparaît, un extrait perd ses marques.
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*?([^*]*)\*\*?/g, '$1')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Emojis, avec leurs variantes de couleur et leurs assemblages : la
      // voix en lisait le nom officiel.
      .replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu, '')
      .replace(/[️‍⃣]/g, '')
      // Les smileys en caractères (« :) », « ^^ », « <3 ») : la voix disait
      // « deux points parenthèse ».
      .replace(/(^|\s)([:;=xX8]-?[)(DPp/\\|*]+|\^\^|\^_\^|<3|xD)(?=\s|$|[.,!?])/g, '$1')
      // Un domaine écrit sans « https » se dit par son nom, comme le reste :
      // « youtube », pas « youtube point com », et surtout pas
      // « api point groq point com ».
      .replace(
        /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|fr|io|dev|app|org|net|co|ai|me|site|shop|eu|be|ch|ca))\b(\/\S*[^\s.,;:!?])?/gi,
        (_m, hote: string) => nomDeSite(hote)
      )
      // Un fichier se dit sans son extension, et ses tirets sont des espaces.
      .replace(new RegExp(`\\b([\\w-]+)\\.(${EXTENSIONS})\\b`, 'gi'), (_m, nom: string) =>
        nom.replace(/[-_]+/g, ' ')
      )
      // Un numéro de version se dit chiffre par chiffre : laissé tel quel, la
      // voix française lit « zéro virgule trois point un ».
      .replace(/\b(\d+)\.(\d+)\.(\d+)\b/g, '$1 point $2 point $3')
      // Deux nombres séparés d'un point ne font une version que si on le dit :
      // « 1.5 Go » doit rester un nombre.
      .replace(/\b(version\s+|v)(\d+)\.(\d+)\b/gi, '$1$2 point $3')
      // Un raccourci se dit comme on le lit à quelqu'un : « Contrôle, Majuscule
      // et Espace », pas « Ctrl plus Maj plus Espace ».
      .replace(/\b(Ctrl|Control|Cmd|Alt|Shift|Maj|Super|Win)\s*\+\s*/gi, (_m, touche: string) => {
        const dit: Record<string, string> = {
          ctrl: 'Contrôle',
          control: 'Contrôle',
          cmd: 'Commande',
          alt: 'Alt',
          shift: 'Majuscule',
          maj: 'Majuscule',
          super: 'Windows',
          win: 'Windows'
        }
        return `${dit[touche.toLowerCase()] ?? touche} `
      })
      // Symboles : une flèche ou une barre se dit comme une pause, une
      // esperluette comme « et ». Le reste se tait.
      .replace(/\s*(→|⟶|=>|->|—>|\|)\s*/g, ', ')
      .replace(/\s&\s/g, ' et ')
      .replace(/[·•◦▪►▶✓✔✗✘#~^_=<>{}[\]\\]/g, ' ')
      // Seulement devant la virgule et le point qui ferment vraiment : sans le
      // regard en avant, « le fichier .env » devenait « le fichier.env », que
      // la voix lit d'un seul tenant.
      .replace(/\s+([,.])(?=\s|$)/g, '$1')
      .replace(/([,.]){2,}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function nettoyer(brut: string, dossierTravail: string): string {
  return pourLaVoix(brut, dossierTravail)
}

/** Longueur en dessous de laquelle on préfère attendre la suite. */
const MINI = 14

/**
 * Abréviations et initiales : le point qui les suit n'est pas une fin de
 * phrase. Couper là donnait « M. » prononcé seul, puis une reprise au milieu
 * de la phrase — c'est exactement ce qui s'entend comme un bug.
 */
const ABREGE = /(?:\b[A-ZÉÈÀ]|\betc|\bex|\bp|\bcf|\bM|\bMme|\bDr|\bSt|\bn°|\bno|\bréf|\bvs|\bmin|\bmax|\benv)$/

/**
 * Découpe un tampon en phrases prononçables et rend ce qui reste en attente.
 * Une phrase trop courte est recollée à la suivante : « Oui. » puis « Je
 * regarde. » synthétisés séparément s'entendent comme un hoquet.
 */
export function decouper(tampon: string): { phrases: string[]; reste: string } {
  const phrases: string[] = []
  let courant = ''
  let reste = tampon

  // Les deux-points ne coupent plus : « Deux choses : la première… » est une
  // seule phrase à l'oreille, et la couper y mettait un silence de fin.
  const coupure = /[.!?…]["»)]?\s|\n/

  for (;;) {
    const m = coupure.exec(reste)
    if (!m) break
    const fin = m.index + m[0].length
    const avant = (courant + reste.slice(0, m.index)).trimEnd()
    courant += reste.slice(0, fin)
    reste = reste.slice(fin)
    // Une abréviation ou une initiale : on continue la phrase.
    if (ABREGE.test(avant)) continue
    if (courant.trim().length >= MINI) {
      phrases.push(courant.trim())
      courant = ''
    }
  }

  return { phrases, reste: courant + reste }
}

/**
 * Parle au fil de l'eau.
 *
 * Les morceaux d'audio sont rendus à l'appelant dans l'ordre : c'est le
 * renderer qui les joue, parce que le main n'a pas de sortie audio et qu'une
 * fenêtre sait, elle, interrompre une lecture en cours.
 */
export class Diseur {
  private tampon = ''
  private file: Promise<void> = Promise.resolve()
  private vivant = true
  /** Phrases envoyées à la synthèse et pas encore rendues. */
  private enCours = 0

  constructor(
    private reglages: Reglages,
    private sur: (mp3: Buffer) => void,
    /** Journal : ce qui est réellement prononcé, phrase par phrase. */
    private noter: (ligne: string) => void = () => {}
  ) {}

  /** Ajoute du texte reçu de l'agent et parle ce qui forme des phrases. */
  pousser(delta: string): void {
    if (!this.vivant) return
    this.tampon += delta
    const { phrases, reste } = decouper(this.tampon)
    this.tampon = reste
    for (const phrase of phrases) this.enfiler(phrase)
  }

  /**
   * Prononce le fond du tampon sans rien clore.
   *
   * À appeler dès que l'agent cesse de parler pour agir : une phrase finie
   * juste avant un outil n'a pas d'espace après son point, donc elle restait
   * en attente, et la phrase suivante s'y collait — « …tes
   * Téléchargements.C'est dans tes Téléchargements… », dit d'un seul souffle.
   */
  finirPhrase(): void {
    if (!this.vivant) return
    const reste = this.tampon.trim()
    this.tampon = ''
    if (reste) this.enfiler(reste)
  }

  /** Prononce le fond du tampon : la réponse est finie. */
  terminer(): void {
    this.finirPhrase()
  }

  /** Coupe : plus rien ne sera synthétisé ni rendu. */
  taire(): void {
    this.vivant = false
    this.tampon = ''
  }

  /** Attend la fin des synthèses déjà lancées. */
  attendre(): Promise<void> {
    return this.file
  }

  /**
   * Il reste des phrases à synthétiser. La file de lecture se vide entre deux
   * phrases dès que la synthèse est plus lente que la voix : ce silence n'est
   * pas la fin de la réponse.
   */
  get occupe(): boolean {
    return this.vivant && this.enCours > 0
  }

  private enfiler(brut: string): void {
    const texte = nettoyer(brut, this.reglages.dossier)
    // Rien à dire s'il ne reste ni lettre ni chiffre : une phrase faite d'un
    // emoji et d'un point devenait « . », que la voix lisait « point ».
    if (!/[\p{L}\p{N}]/u.test(texte)) return
    // Une seule file : les phrases doivent sortir dans l'ordre où elles ont
    // été écrites, et deux synthèses parallèles reviennent dans le désordre.
    this.enCours++
    // Le texte prononcé n'est pas celui qui s'affiche : quand elle « parle
    // mal », c'est ici que ça se voit, pas dans la réponse écrite.
    this.noter(`dit : ${texte.slice(0, 120)}`)
    this.file = this.file.then(async () => {
      if (!this.vivant) return
      try {
        const mp3 = await synthetiser(texte, this.reglages)
        this.enCours--
        if (this.vivant && mp3.length) this.sur(mp3)
      } catch {
        this.enCours--
        // Une phrase muette valait mieux qu'un tour interrompu : la réponse
        // reste lisible à l'écran.
        tts = null
        voixOuverte = ''
      }
    })
  }
}

/** Synthétise une phrase et rend le MP3 complet. */
export async function synthetiser(texte: string, reglages: Reglages): Promise<Buffer> {
  const client = await connexion(reglages.voix)
  const { audioStream } = client.toStream(texte, {
    rate: reglages.debit,
    pitch: TONS[reglages.ton]?.hauteur ?? '+0%'
  })
  const morceaux: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    audioStream.on('data', (c: Buffer) => morceaux.push(c))
    audioStream.on('end', () => resolve())
    audioStream.on('error', reject)
  })
  return Buffer.concat(morceaux)
}

/** Ferme la connexion : appelé à la fermeture de l'application. */
export function fermer(): void {
  tts?.close()
  tts = null
  voixOuverte = ''
}
