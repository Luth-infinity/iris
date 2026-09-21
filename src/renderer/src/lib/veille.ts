import { createModel, type Model } from 'vosk-browser'
import { ANNULATIONS, FINS_ENVOI, aplatir } from './commandes'
import { flux as ouvrirFlux } from './micro'

/**
 * La veille : dire « Iris » suffit à la réveiller, sans toucher au clavier.
 *
 * Tout se passe sur la machine, avec le petit modèle Vosk français en
 * WebAssembly. Envoyer le flux du micro à un service de transcription toute la
 * journée coûterait cher et enverrait dehors tout ce qui se dit dans la pièce ;
 * ici rien ne sort.
 *
 * **Le modèle transcrit librement, sans grammaire restreinte.** Une grammaire
 * réduite à `["iris", "[unk]"]` semblait plus sobre, mais le décodeur, qui n'a
 * alors que ce mot à proposer, y ramène n'importe quelle parole : « Il fait
 * beau aujourd'hui, je vais sortir » la réveillait. Le modèle complet transcrit
 * cette phrase mot pour mot, et ne dit « iris » que quand on le prononce.
 * Mesuré sur deux voix et une phrase piège, avec `verif/`.
 */

const MOT = 'iris'

/** En dessous, c'est du silence : inutile de réveiller le reconnaisseur. */
const SEUIL_SILENCE = 0.014
/**
 * Morceaux encore envoyés après le dernier son fort. Assez pour ne pas couper
 * la fin d'un mot, assez peu pour qu'une pause d'une demi-seconde sépare deux
 * énoncés : c'est ce qui isole « Iris » dans « Bon, je vais demander. Iris. »
 */
const TRAINE = 8
/** Deux déclenchements rapprochés viennent du même mot prononcé une fois. */
const REPOS_ENTRE_DEUX = 2500
/** Taille des morceaux : 4096 échantillons, soit environ 85 ms à 48 kHz. */
const MORCEAU = 4096

type Reconnaisseur = {
  acceptWaveformFloat(b: Float32Array, r: number): void
  retrieveFinalResult(): void
  remove(): void
}

/**
 * Ce que la veille guette.
 *
 * `appel` : Iris est au repos, on attend son nom. `commande` : Iris écoute une
 * demande, et le même reconnaisseur local sert à entendre « c'est bon » ou
 * « laisse tomber ». Le micro de la demande part chez Groq une fois fini, trop
 * tard pour réagir à ces mots pendant qu'on les dit.
 */
export type Mode = 'appel' | 'commande'

/** Ce qu'une commande vocale demande de faire à l'écoute en cours. */
export type Commande = 'envoyer' | 'annuler'

export class Veille {
  private modele: Model | null = null
  private reconnaisseur: Reconnaisseur | null = null
  private ctx: AudioContext | null = null
  private flux: MediaStream | null = null
  private noeud: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private ecoute = true
  private dernierMot = 0
  private traine = 0
  private mode: Mode = 'appel'
  /** Branché par l'overlay : les commandes agissent sur son enregistrement. */
  surCommande: ((c: Commande) => void) | null = null
  /** Branché par l'overlay : ce que la veille entend, vers `journal.log`. */
  journal: ((ligne: string) => void) | null = null

  private constructor(private surMot: () => void) {}

  /**
   * L'instance partagée de la fenêtre.
   *
   * En développement, React monte les effets deux fois : sans ce verrou, le
   * modèle de quarante mégaoctets était déballé deux fois et deux micros
   * s'ouvraient à chaque lancement.
   */
  private static partage: Promise<Veille> | null = null

  static partagee(
    octets: Uint8Array,
    peripherique: string,
    surMot: () => void
  ): Promise<Veille> {
    Veille.partage ??= Veille.ouvrir(octets, peripherique, surMot).catch((err) => {
      // Un échec ne doit pas condamner les tentatives suivantes.
      Veille.partage = null
      throw err
    })
    return Veille.partage
  }

  /**
   * Charge le modèle et ouvre le micro.
   *
   * Les octets du modèle viennent du main : le worker de Vosk réclame une URL,
   * et une URL d'objet créée ici est la seule qu'il puisse lire aussi bien en
   * développement qu'une fois l'application empaquetée.
   */
  private static async ouvrir(
    octets: Uint8Array,
    peripherique: string,
    surMot: () => void
  ): Promise<Veille> {
    const veille = new Veille(surMot)
    // `Uint8Array<ArrayBufferLike>` ne passe pas pour un `BlobPart` : le type
    // couvre aussi la mémoire partagée, que `Blob` refuse. La vue est recopiée
    // dans un tampon simple.
    const tampon = new Uint8Array(octets.byteLength)
    tampon.set(octets)
    const url = URL.createObjectURL(new Blob([tampon.buffer], { type: 'application/gzip' }))
    try {
      veille.modele = await createModel(url)
    } finally {
      // Le modèle est déballé dans le système de fichiers du worker : garder
      // quarante mégaoctets dans l'objet ne servirait plus à rien.
      URL.revokeObjectURL(url)
    }

    // Même repli que l'écoute : un identifiant de micro périmé laissait la
    // veille hors service dès le démarrage (« OverconstrainedError »).
    const flux = await ouvrirFlux(peripherique, { echoCancellation: true }, () =>
      veille.journal?.('micro choisi introuvable, micro par défaut utilisé')
    )
    veille.flux = flux

    const ctx = new AudioContext()
    veille.ctx = ctx
    // Pas de grammaire : voir la note en tête de fichier.
    const reconnaisseur = new veille.modele.KaldiRecognizer(ctx.sampleRate)

    // Les résultats partiels plutôt que les seuls définitifs : un définitif
    // attend la fin de la traîne, et ce délai après le mot se sent.
    reconnaisseur.on('partialresult', (message) => {
      veille.examiner((message as { result?: { partial?: string } }).result?.partial ?? '', false)
    })
    reconnaisseur.on('result', (message) => {
      veille.examiner((message as { result?: { text?: string } }).result?.text ?? '', true)
    })
    veille.reconnaisseur = reconnaisseur

    // `ScriptProcessorNode` est déprécié, mais un `AudioWorklet` réclame un
    // module servi à part, ce qu'un paquet Electron ne fournit pas sans
    // détour. Le coût est nul : on ne fait que recopier le tampon.
    const noeud = ctx.createScriptProcessor(MORCEAU, 1, 1)
    noeud.onaudioprocess = (e) => veille.traiter(e.inputBuffer.getChannelData(0))
    veille.noeud = noeud

    const source = ctx.createMediaStreamSource(flux)
    veille.source = source
    source.connect(noeud)
    // Le nœud doit être relié à la sortie pour être appelé, mais rien ne doit
    // s'entendre : un gain à zéro fait l'affaire.
    const muet = ctx.createGain()
    muet.gain.value = 0
    noeud.connect(muet).connect(ctx.destination)

    return veille
  }

  /** Iris parle ou travaille : on arrête d'écouter son propre nom. */
  suspendre(): void {
    this.ecoute = false
    this.traine = 0
  }

  reprendre(): void {
    this.ecoute = true
  }

  /**
   * Change ce que la veille guette, et repart d'un énoncé vierge.
   *
   * L'énoncé en cours est clos et son résultat ignoré : il contient « Iris »
   * quand on passe en commande, et sa fin serait lue comme une commande.
   */
  ecouterEn(mode: Mode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.traine = 0
    if (this.reconnaisseur) {
      this.ignorerFinal = true
      this.reconnaisseur.retrieveFinalResult()
    }
  }

  private ignorerFinal = false

  arreter(): void {
    Veille.partage = null
    this.ecoute = false
    this.noeud?.disconnect()
    this.source?.disconnect()
    this.noeud = null
    this.source = null
    this.flux?.getTracks().forEach((t) => t.stop())
    this.flux = null
    this.reconnaisseur?.remove()
    this.reconnaisseur = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.modele?.terminate()
    this.modele = null
  }

  private traiter(echantillons: Float32Array): void {
    if (!this.ecoute || !this.reconnaisseur || !this.ctx) return

    let somme = 0
    for (const v of echantillons) somme += v * v
    const rms = Math.sqrt(somme / echantillons.length)

    if (rms > SEUIL_SILENCE) {
      this.traine = TRAINE
    } else if (this.traine > 0) {
      this.traine--
      // Fin de la traîne : on clôt l'énoncé. Sans ça, le partiel s'allonge
      // indéfiniment et le décodeur garde en tête une phrase que plus
      // personne ne prononce.
      if (this.traine === 0) this.reconnaisseur.retrieveFinalResult()
    } else {
      // Le silence ne passe pas : le reconnaisseur tournerait pour rien, et
      // c'est ce qui fait la différence entre une veille discrète et un cœur
      // de processeur occupé en permanence.
      return
    }

    // Le tampon est réutilisé par Chromium d'un appel à l'autre : le worker
    // recevrait des échantillons déjà remplacés.
    this.reconnaisseur.acceptWaveformFloat(new Float32Array(echantillons), this.ctx.sampleRate)
  }

  private examiner(texte: string, definitif: boolean): void {
    // Au repos, la veille entend tout ce qui se dit dans la pièce : on ne
    // consigne que ce qui la concerne (son nom), jamais le reste.
    if (definitif && (this.mode === 'commande' || /\biris\b/i.test(texte))) {
      this.journal?.(
        `veille (${this.mode}${this.ignorerFinal ? ', ignoré' : ''}) : « ${texte.slice(0, 60)} »`
      )
    }
    if (definitif && this.ignorerFinal) {
      this.ignorerFinal = false
      return
    }
    if (this.mode === 'commande') {
      // Les commandes attendent la fin de l'énoncé : sur un partiel,
      // « arrête » pourrait être le début de « arrête le serveur ».
      if (definitif) this.examinerCommande(texte)
      return
    }

    const mots = aplatir(texte).split(' ').filter(Boolean)
    // C'est le **dernier** mot qui compte, pas l'énoncé entier : on appelle
    // Iris au milieu d'une phrase, ou juste après avoir parlé à quelqu'un
    // d'autre.
    if (mots[mots.length - 1] !== MOT) return

    const maintenant = Date.now()
    if (maintenant - this.dernierMot < REPOS_ENTRE_DEUX) return
    this.dernierMot = maintenant
    this.suspendre()
    this.surMot()
  }

  private examinerCommande(texte: string): void {
    const phrase = aplatir(texte)
    if (!phrase) return
    if (ANNULATIONS.includes(phrase)) this.surCommande?.('annuler')
    else if (FINS_ENVOI.some((f) => phrase === f || phrase.endsWith(' ' + f))) {
      this.surCommande?.('envoyer')
    }
  }
}
