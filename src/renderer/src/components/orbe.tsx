import { cn } from '@renderer/lib/utils'
import type { Etat } from '@shared/conversation'

/**
 * L'orbe. C'est la seule chose qui dit ce qu'Iris est en train de faire, donc
 * chaque état a son mouvement propre : elle respire au repos, gonfle avec la
 * voix pendant l'écoute, tourne pendant qu'elle réfléchit, bat pendant qu'elle
 * parle. Un état qui ne bouge pas se lit comme une application figée.
 */
export function Orbe({
  etat,
  niveau = 0,
  dansAnneau = false,
  className
}: {
  etat: Etat
  /** Niveau du micro, 0 à 1. Ne sert qu'en écoute. */
  niveau?: number
  /**
   * Posée au centre de l'anneau, l'orbe abandonne son halo et son arc : c'est
   * l'anneau qui porte le mouvement, et les deux ensemble faisaient surchargé.
   */
  dansAnneau?: boolean
  className?: string
}): JSX.Element {
  const ecoute = etat === 'ecoute'
  const pense = !dansAnneau && (etat === 'reflexion' || etat === 'transcription')
  const parle = etat === 'parole'
  const erreur = etat === 'erreur'

  return (
    <div className={cn('relative h-10 w-10 flex-shrink-0', className)}>
      {/* Halo qui s'échappe pendant l'écoute et la parole. */}
      {!dansAnneau && (ecoute || parle) && (
        <span
          className={cn(
            'animate-ripple absolute inset-1 rounded-full',
            erreur ? 'bg-destructive/40' : 'bg-iris/40'
          )}
        />
      )}

      {/* Anneau de réflexion : un arc qui tourne autour du noyau. */}
      {pense && (
        <span className="animate-tourne absolute inset-0 rounded-full border-2 border-iris/15 border-t-iris" />
      )}

      {/* Le noyau. Le dégradé décentré lui donne son volume. */}
      <span
        className={cn(
          'absolute inset-[6px] rounded-full transition-[box-shadow,background] duration-300',
          erreur
            ? 'bg-[radial-gradient(circle_at_32%_28%,oklch(var(--destructive)),oklch(var(--destructive)/0.55))]'
            : 'bg-[radial-gradient(circle_at_32%_28%,oklch(var(--iris)/0.95),oklch(var(--iris)/0.5))]',
          etat === 'repos' && 'animate-respire',
          parle && 'animate-respire shadow-[0_0_18px_2px_oklch(var(--iris)/0.35)]',
          ecoute && 'shadow-[0_0_14px_1px_oklch(var(--iris)/0.3)]'
        )}
        style={
          // Pendant l'écoute, l'orbe suit la voix : c'est le retour qui prouve
          // que le bon micro est ouvert, avant même la transcription.
          ecoute ? { transform: `scale(${1 + Math.min(niveau, 1) * 0.28})` } : undefined
        }
      />
    </div>
  )
}
