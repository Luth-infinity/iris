import { Check } from 'lucide-react'
import type { Tache } from '@shared/conversation'
import { cn } from '@renderer/lib/utils'

/**
 * Les bulles de travail : la liste de tâches de Claude Code, et l'action du
 * moment.
 *
 * C'est ce qui dit « je m'en occupe » sans parler : on voit les étapes
 * s'allumer puis se cocher, dans les mots de l'agent (« Tâche 2 · Création de
 * b.txt »), sans avoir à ouvrir quoi que ce soit.
 */

/** Au-delà, la colonne déborderait de la fenêtre : on montre une fenêtre glissante. */
const VISIBLES = 5

/** Les tâches à montrer : une fenêtre de cinq autour de celle en cours. */
function fenetre(taches: Tache[]): { montrees: Tache[]; avant: number; apres: number } {
  if (taches.length <= VISIBLES) return { montrees: taches, avant: 0, apres: 0 }
  const courante = taches.findIndex((t) => t.statut === 'in_progress')
  // Sans tâche en cours, la première qui reste à faire tient lieu de repère.
  const repere = courante >= 0 ? courante : Math.max(0, taches.findIndex((t) => t.statut === 'pending'))
  const debut = Math.min(Math.max(0, repere - 1), taches.length - VISIBLES)
  return {
    montrees: taches.slice(debut, debut + VISIBLES),
    avant: debut,
    apres: taches.length - debut - VISIBLES
  }
}

function Pastille({
  className,
  style,
  children
}: {
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}): JSX.Element {
  // Deux niveaux : l'animation d'entrée garde son état final (`both`), dont
  // l'opacité à 1 écrasait celle d'une tâche faite. L'entrée vit dehors, le
  // style de la bulle dedans.
  return (
    <div style={style} className="animate-bulle max-w-[280px]">
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border border-shell-border bg-shell/95 py-1.5 pl-2 pr-3 text-[12px] leading-none shadow-[0_2px_10px_oklch(0_0_0/0.25)] transition-[opacity,border-color] duration-300',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Le témoin d'une tâche : cercle vide, anneau qui tourne, ou coche. */
function Temoin({ statut }: { statut: Tache['statut'] }): JSX.Element {
  if (statut === 'completed') {
    return (
      <span className="grid h-3.5 w-3.5 flex-shrink-0 place-items-center rounded-full bg-positive/20 text-positive">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    )
  }
  if (statut === 'in_progress') {
    return (
      <span className="animate-tourne h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-iris/25 border-t-iris" />
    )
  }
  return <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-shell-muted/60" />
}

export function BulleTache({ tache, index }: { tache: Tache; index: number }): JSX.Element {
  const enCours = tache.statut === 'in_progress'
  const faite = tache.statut === 'completed'
  return (
    <Pastille
      // Les bulles arrivent en cascade, pas d'un bloc.
      style={{ animationDelay: `${index * 45}ms` }}
      className={cn(enCours && 'border-iris/40', faite && 'opacity-60')}
    >
      <Temoin statut={tache.statut} />
      <span className="flex-shrink-0 text-shell-muted">Tâche {tache.id}</span>
      <span className="truncate text-shell-foreground">{enCours ? tache.enCours : tache.titre}</span>
    </Pastille>
  )
}

/** L'action en cours quand il n'y a pas (ou pas encore) de liste de tâches. */
export function BulleActivite({ libelle }: { libelle: string }): JSX.Element {
  return (
    <Pastille key={libelle}>
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-iris/60" />
        <span className="relative h-2 w-2 rounded-full bg-iris" />
      </span>
      <span className="truncate text-shell-foreground">{libelle}</span>
    </Pastille>
  )
}

/**
 * La colonne complète, alignée à droite contre la pastille : les tâches, puis
 * l'action du moment si elle apporte quelque chose de plus.
 */
export function Bulles({
  taches,
  activite
}: {
  taches: Tache[]
  activite: string | null
}): JSX.Element | null {
  if (!taches.length && !activite) return null
  const { montrees, avant, apres } = fenetre(taches)

  return (
    <div className="flex flex-col items-end gap-1.5">
      {avant > 0 && (
        <span className="pr-3 text-[10px] text-shell-muted">
          {avant} tâche{avant > 1 ? 's' : ''} avant
        </span>
      )}
      {montrees.map((t, i) => (
        <BulleTache key={t.id} tache={t} index={i} />
      ))}
      {apres > 0 && (
        <span className="pr-3 text-[10px] text-shell-muted">
          et {apres} autre{apres > 1 ? 's' : ''}
        </span>
      )}
      {activite && <BulleActivite libelle={activite} />}
    </div>
  )
}

/** Bilan de fin : « 3 tâches terminées », quand il y en avait plusieurs. */
export function BilanTaches({ taches }: { taches: Tache[] }): JSX.Element | null {
  const faites = taches.filter((t) => t.statut === 'completed').length
  if (taches.length < 2 || faites < taches.length) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/15 px-2 py-0.5 text-[11px] text-positive">
      <Check className="h-3 w-3" strokeWidth={3} />
      {faites} tâches terminées
    </span>
  )
}
