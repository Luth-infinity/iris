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
export function pourLaVoix(brut: string, dossierTravail = ''): string {
  // Les adresses d'abord : « https://… » ressemble à un chemin (« s:/ »), et
  // le filtre des chemins en gardait le dernier morceau.
  const sansAdresses = brut
    .replace(/https?:\/\/(www\.)?([a-z0-9-]+)[^\s)]*/gi, '$2')
    .replace(/\bwww\.([a-z0-9-]+)\.[a-z.]{2,}\S*/gi, '$1')
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
      // Un nom de site se dit comme à l'oral : « github point com ». Une
      // adresse complète, elle, est réduite plus haut au seul nom.
      .replace(/\b([a-z0-9-]+)\.(com|fr|io|dev|app|org|net|co|ai)\b(\/\S*)?/gi, '$1 point $2')
      // Un fichier se dit sans son extension, et ses tirets sont des espaces.
      .replace(new RegExp(`\\b([\\w-]+)\\.(${EXTENSIONS})\\b`, 'gi'), (_m, nom: string) =>
        nom.replace(/[-_]+/g, ' ')
      )
      // Symboles : une flèche ou une barre se dit comme une pause, une
      // esperluette comme « et ». Le reste se tait.
      .replace(/\s*(→|⟶|=>|->|—>|\|)\s*/g, ', ')
      .replace(/\s&\s/g, ' et ')
      .replace(/[·•◦▪►▶✓✔✗✘#~^_=<>{}[\]\\]/g, ' ')
      // Seulement devant la virgule et le point : « ! » et « ? » gardent
      // l'espace français, que la voix ignore de toute façon.
      .replace(/\s+([,.])/g, '$1')
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
 * Découpe un tampon en phrases prononçables et rend ce qui reste en attente.
 * Une phrase trop courte est recollée à la suivante : « Oui. » puis « Je
 * regarde. » synthétisés séparément s'entendent comme un hoquet.
 */
export function decouper(tampon: string): { phrases: string[]; reste: string } {
  const phrases: string[] = []
  let courant = ''
  let reste = tampon

  const coupure = /[.!?…:]["»)]?\s|\n/

  for (;;) {
    const m = coupure.exec(reste)
    if (!m) break
    const fin = m.index + m[0].length
    courant += reste.slice(0, fin)
    reste = reste.slice(fin)
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
    private sur: (mp3: Buffer) => void
  ) {}

  /** Ajoute du texte reçu de l'agent et parle ce qui forme des phrases. */
  pousser(delta: string): void {
    if (!this.vivant) return
    this.tampon += delta
    const { phrases, reste } = decouper(this.tampon)
    this.tampon = reste
    for (const phrase of phrases) this.enfiler(phrase)
  }

  /** Prononce le fond du tampon : la réponse est finie. */
  terminer(): void {
    if (!this.vivant) return
    const reste = this.tampon.trim()
    this.tampon = ''
    if (reste) this.enfiler(reste)
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
