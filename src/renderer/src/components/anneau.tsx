import { useEffect, useRef } from 'react'
import type { Etat } from '@shared/conversation'

/**
 * L'anneau : la signature d'Iris à l'écran.
 *
 * Une couronne de traits autour de l'orbe, qui suit le spectre de la voix —
 * la nôtre pendant qu'on parle, la sienne pendant qu'elle répond. C'est
 * volontairement la même forme dans les deux sens : une seule voix visuelle,
 * là où une pilule à barres horizontales ne dirait que « dictée en cours ».
 *
 * Tout est peint dans un canvas : soixante-douze traits animés à chaque image
 * en DOM coûteraient plus cher que ce qu'ils montrent.
 */

/**
 * Le nombre de traits suit la taille : les soixante-douze de la barre se
 * touchent sur la pastille, où la circonférence est quatre fois plus courte.
 */
function densite(taille: number): { traits: number; epaisseur: number } {
  return taille < 120 ? { traits: 40, epaisseur: 1.6 } : { traits: 72, epaisseur: 2.2 }
}

export function Anneau({
  analyseur,
  etat,
  taille,
  surNiveau
}: {
  /** Spectre à suivre, ou `null` quand personne ne parle. */
  analyseur: AnalyserNode | null
  etat: Etat
  /** Diamètre en pixels CSS. */
  taille: number
  /** Niveau global, remonté pour faire respirer l'orbe au centre. */
  surNiveau?: (niveau: number) => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sondeRef = useRef<HTMLSpanElement>(null)
  const sondeErreurRef = useRef<HTMLSpanElement>(null)
  // Gardés dans des refs : la boucle d'animation ne doit pas se relancer à
  // chaque image, et elle a pourtant besoin de la valeur du moment.
  const analyseurRef = useRef(analyseur)
  const etatRef = useRef(etat)
  analyseurRef.current = analyseur
  etatRef.current = etat

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = taille * dpr
    canvas.height = taille * dpr
    ctx.scale(dpr, dpr)

    const centre = taille / 2
    const interne = taille * 0.31
    const maxi = taille * 0.17
    const { traits: TRAITS, epaisseur } = densite(taille)
    /** La moitié du spectre est recopiée en miroir : une couronne symétrique. */
    const MOITIE = TRAITS / 2

    const spectre = new Uint8Array(1024)
    const lisse = new Array<number>(TRAITS).fill(0)
    /** Les couleurs viennent des jetons : le canvas ne connaît pas Tailwind. */
    let iris = 'rgb(140,120,255)'
    let rouge = 'rgb(240,80,70)'
    let image = 0
    let temps = 0

    const boucle = (): void => {
      temps += 1
      // Deux fois par seconde suffit à suivre un changement de thème, et
      // `getComputedStyle` à chaque image coûterait plus que le dessin.
      if (temps % 30 === 1) {
        if (sondeRef.current) iris = getComputedStyle(sondeRef.current).color || iris
        if (sondeErreurRef.current) {
          rouge = getComputedStyle(sondeErreurRef.current).color || rouge
        }
      }
      // L'anneau passe au rouge avec l'orbe : un anneau resté violet autour
      // d'un noyau rouge se lisait comme un défaut d'affichage.
      const couleur = etatRef.current === 'erreur' ? rouge : iris

      const source = analyseurRef.current
      const cibles = new Array<number>(TRAITS)

      if (source) {
        source.getByteFrequencyData(spectre)
        // Seul le bas du spectre porte la voix : au-delà, les traits ne
        // bougeraient plus du tout.
        const utiles = Math.floor(source.frequencyBinCount * 0.42)
        for (let i = 0; i < MOITIE; i++) {
          const debut = Math.floor((i / MOITIE) * utiles)
          const fin = Math.max(debut + 1, Math.floor(((i + 1) / MOITIE) * utiles))
          let somme = 0
          for (let b = debut; b < fin; b++) somme += spectre[b]
          const moyenne = somme / (fin - debut) / 255
          // Racine : la voix vit dans le bas de l'échelle linéaire, et sans
          // cette correction la couronne reste presque plate.
          const valeur = Math.min(1, Math.sqrt(moyenne) * 1.25)
          cibles[i] = valeur
          cibles[TRAITS - 1 - i] = valeur
        }
      } else if (etatRef.current === 'repos') {
        // Au repos, l'anneau respire d'un souffle unique : rien ne se passe,
        // et un anneau figé se lit comme une application plantée.
        const souffle = 0.05 + 0.035 * (0.5 + 0.5 * Math.sin(temps * 0.035))
        cibles.fill(souffle)
      } else {
        // Au travail : une comète fait le tour de l'anneau. Une onde à
        // plusieurs lobes donnait une forme de poire, qui se lisait comme un
        // défaut d'affichage plutôt que comme une attente.
        const tete = ((temps * 0.011) % 1) * TRAITS
        for (let i = 0; i < TRAITS; i++) {
          // Distance à la tête, en nombre de traits, en tenant compte du tour.
          const brut = Math.abs(i - tete)
          const distance = Math.min(brut, TRAITS - brut)
          cibles[i] = 0.07 + 0.62 * Math.exp(-((distance / (TRAITS / 14)) ** 2))
        }
      }

      ctx.clearRect(0, 0, taille, taille)
      ctx.strokeStyle = couleur
      ctx.lineCap = 'round'
      ctx.shadowColor = couleur

      let total = 0
      for (let i = 0; i < TRAITS; i++) {
        // Lissage temporel : la montée suit la voix, la descente traîne un
        // peu, sinon la couronne clignote.
        const cible = cibles[i]
        lisse[i] = cible > lisse[i] ? cible : lisse[i] * 0.82 + cible * 0.18
        total += lisse[i]

        const angle = (i / TRAITS) * Math.PI * 2 - Math.PI / 2
        const longueur = 2 + lisse[i] * maxi
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        ctx.globalAlpha = 0.35 + lisse[i] * 0.65
        ctx.lineWidth = epaisseur
        ctx.shadowBlur = 6 * lisse[i]
        ctx.beginPath()
        ctx.moveTo(centre + cos * interne, centre + sin * interne)
        ctx.lineTo(centre + cos * (interne + longueur), centre + sin * (interne + longueur))
        ctx.stroke()
      }

      surNiveau?.(Math.min(1, total / TRAITS))
      image = requestAnimationFrame(boucle)
    }

    boucle()
    return () => cancelAnimationFrame(image)
  }, [taille, surNiveau])

  return (
    <>
      {/* Sondes invisibles : elles portent les jetons de couleur, que le
          canvas lit. */}
      <span ref={sondeRef} className="hidden text-iris" aria-hidden />
      <span ref={sondeErreurRef} className="hidden text-destructive" aria-hidden />
      <canvas
        ref={canvasRef}
        style={{ width: taille, height: taille }}
        className="pointer-events-none"
      />
    </>
  )
}
