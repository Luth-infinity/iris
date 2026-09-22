/**
 * File de lecture de la voix.
 *
 * Le main synthétise phrase par phrase et les envoie dès qu'elles sont
 * prêtes ; elles doivent s'enchaîner sans trou ni chevauchement, et s'arrêter
 * net quand on coupe Iris au milieu d'un mot.
 *
 * La lecture passe par la pile audio plutôt que par un simple `Audio` isolé :
 * l'anneau de l'écran doit bouger quand Iris parle, exactement comme il bouge
 * quand c'est nous. C'est la même voix visuelle dans les deux sens.
 */
export class FileLecture {
  private file: string[] = []
  private element: HTMLAudioElement | null = null
  /**
   * La phrase suivante, déjà décodée pendant que la précédente se joue.
   *
   * Sans elle, chaque phrase attendait sa création et son décodage : un blanc
   * d'une fraction de seconde entre deux phrases d'une même réponse, qui
   * s'entend comme un hoquet.
   */
  private suivante: { element: HTMLAudioElement; source?: MediaElementAudioSourceNode } | null = null
  private joue = false
  private ctx: AudioContext | null = null
  private _analyseur: AnalyserNode | null = null

  constructor(private surFin: () => void) {}

  /** Ajoute un MP3 encodé en base64 et démarre la lecture si elle dort. */
  ajouter(base64: string): void {
    this.file.push(base64)
    if (!this.joue) void this.suivant()
  }

  /** Coupe la lecture en cours et oublie la file. */
  taire(): void {
    this.file = []
    if (this.element) {
      this.element.pause()
      this.element.src = ''
      this.element = null
    }
    if (this.suivante) {
      this.suivante.element.src = ''
      this.suivante = null
    }
    this.joue = false
  }

  get enLecture(): boolean {
    return this.joue
  }

  /** Le spectre de ce qu'Iris est en train de dire, ou `null` au silence. */
  get analyseur(): AnalyserNode | null {
    return this.joue ? this._analyseur : null
  }

  /**
   * Un seul contexte pour toute la session : en créer un par phrase finissait
   * par heurter la limite de Chromium après quelques dizaines d'échanges.
   */
  private pile(): { ctx: AudioContext; analyseur: AnalyserNode } {
    if (!this.ctx || !this._analyseur) {
      this.ctx = new AudioContext()
      this._analyseur = this.ctx.createAnalyser()
      this._analyseur.fftSize = 1024
      this._analyseur.smoothingTimeConstant = 0.72
      this._analyseur.connect(this.ctx.destination)
    }
    return { ctx: this.ctx, analyseur: this._analyseur }
  }

  /**
   * Prépare un morceau : l'élément, sa place dans la pile audio, et le
   * décodage lancé d'avance.
   */
  private preparer(morceau: string): { element: HTMLAudioElement; source?: MediaElementAudioSourceNode } {
    // Une URL de données plutôt qu'un Blob : pas d'objet à révoquer, et la
    // lecture démarre sans passer par le réseau interne.
    const element = new Audio(`data:audio/mpeg;base64,${morceau}`)
    element.preload = 'auto'
    try {
      const { ctx, analyseur } = this.pile()
      const source = ctx.createMediaElementSource(element)
      source.connect(analyseur)
      element.load()
      return { element, source }
    } catch {
      // Pile audio indisponible : on joue quand même, l'anneau se contentera
      // de son animation au repos.
      element.load()
      return { element }
    }
  }

  private async suivant(): Promise<void> {
    const prete = this.suivante
    this.suivante = null
    const morceau = prete ? null : this.file.shift()
    if (!prete && !morceau) {
      this.joue = false
      this.surFin()
      return
    }

    this.joue = true
    const { element: audio } = prete ?? this.preparer(morceau as string)
    this.element = audio

    try {
      const { ctx } = this.pile()
      // Le contexte démarre suspendu quand la fenêtre n'a jamais eu le focus,
      // ce qui est le cas de l'overlay : sans ça, aucune phrase ne sortirait.
      if (ctx.state === 'suspended') await ctx.resume()
    } catch {
      // Rien à faire de plus : la lecture se passera de l'analyseur.
    }

    // Pendant que celle-ci parle, la suivante se décode.
    const apres = this.file.shift()
    if (apres) this.suivante = this.preparer(apres)

    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      // Un morceau illisible ne doit pas figer la file : on passe au suivant.
      audio.onerror = () => resolve()
      void audio.play().catch(() => resolve())
    })

    // `taire()` a pu passer pendant la lecture : la file est alors vide et
    // l'élément remplacé, il n'y a plus rien à enchaîner.
    if (this.element !== audio) return
    this.element = null
    void this.suivant()
  }
}
