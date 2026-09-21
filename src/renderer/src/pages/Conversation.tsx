import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, Settings2, Wrench } from 'lucide-react'
import type { Etat, Tour } from '@shared/conversation'
import { Badge } from '@renderer/components/ui/badge'
import { BulleTache } from '@renderer/components/bulles'
import { Button } from '@renderer/components/ui/button'
import { Orbe } from '@renderer/components/orbe'
import { useSyncedTheme } from '@renderer/lib/theme'
import { cn } from '@renderer/lib/utils'

/**
 * L'historique : ce qui a été dit, et ce que l'agent a fait pour y arriver.
 *
 * En lecture seule. Il y avait un champ de saisie, et la fenêtre s'ouvrait au
 * démarrage et au clic sur l'icône : Iris ressemblait à une messagerie avec un
 * micro greffé dessus. Elle ne s'ouvre plus que depuis le menu de l'icône.
 */

const LIBELLE: Record<Etat, string> = {
  repos: 'Au repos',
  ecoute: 'Elle écoute',
  transcription: 'Transcription',
  reflexion: 'Elle réfléchit',
  parole: 'Elle parle',
  erreur: 'Erreur'
}

export default function Conversation(): JSX.Element {
  useSyncedTheme()

  const [tours, setTours] = useState<Tour[]>([])
  const [etat, setEtat] = useState<Etat>('repos')
  const filRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.tours().then(setTours)
    void window.api.etat().then(setEtat)

    const off = [
      window.api.surEtat(setEtat),
      window.api.surTour((tour) => setTours((t) => [...t, tour])),
      window.api.surFilVide(() => setTours([])),
      window.api.surEvenement((e) => {
        if (e.type === 'debut') return
        setTours((liste) =>
          liste.map((tour) => {
            if (tour.id !== e.id) return tour
            if (e.type === 'texte') return { ...tour, texte: tour.texte + e.delta }
            if (e.type === 'outil') return { ...tour, outils: [...tour.outils, e.outil] }
            if (e.type === 'taches') return { ...tour, taches: e.taches }
            // `result` fait foi sur le texte final : les deltas peuvent
            // manquer la fin si le flux se coupe.
            return {
              ...tour,
              texte: e.texte || tour.texte,
              erreur: e.erreur,
              termine: true
            }
          })
        )
      })
    ]
    return () => off.forEach((f) => f())
  }, [])

  // Le fil suit le bas pendant que la réponse s'écrit.
  useLayoutEffect(() => {
    const el = filRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [tours])

  const travaille = etat === 'reflexion' || etat === 'parole' || etat === 'transcription'

  return (
    <div className="flex h-full flex-col bg-shell text-shell-foreground">
      {/* En-tête : la barre de titre est masquée, c'est cette zone qui
          déplace la fenêtre. Les boutons doivent en être exclus, et la droite
          reste libre pour les trois boutons de Windows. */}
      <header className="deplacer flex h-[42px] flex-shrink-0 items-center gap-2 border-b border-shell-border px-3 pr-[140px]">
        <Orbe etat={etat} className="h-6 w-6" />
        <span className="text-sm font-medium">Historique</span>
        <Badge variant={travaille ? 'iris' : 'default'}>{LIBELLE[etat]}</Badge>
        <div className="cliquable ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Nouvelle conversation"
            onClick={() => window.api.nouvelleConversation()}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Paramètres"
            onClick={() => window.api.ouvrirParametres()}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div ref={filRef} className="flex-1 select-text overflow-y-auto px-4 py-4">
        {tours.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Orbe etat="repos" className="h-12 w-12" />
            <p className="text-shell-muted">Rien pour l’instant.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tours.map((tour) => (
              <div
                key={tour.id}
                className={cn(
                  'animate-fade-up flex',
                  tour.role === 'moi' ? 'justify-end' : 'justify-start'
                )}
              >
                {tour.role === 'moi' ? (
                  <p className="max-w-[85%] rounded-xl rounded-br-sm bg-shell-raised px-3 py-2 text-shell-foreground">
                    {tour.texte}
                  </p>
                ) : (
                  <div className="max-w-[92%] space-y-1.5">
                    {tour.taches.length > 0 && (
                      <div className="flex flex-col items-start gap-1">
                        {tour.taches.map((t, i) => (
                          <BulleTache key={t.id} tache={t} index={i} />
                        ))}
                      </div>
                    )}
                    {tour.outils.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tour.outils.map((outil, i) => (
                          <Badge key={i} variant="outline" title={outil.detail}>
                            <Wrench className="h-2.5 w-2.5" />
                            <span className="text-[10px]">{outil.libelle || outil.nom}</span>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {tour.erreur ? (
                      <p className="whitespace-pre-wrap rounded-md bg-destructive/10 px-2.5 py-2 text-destructive">
                        {tour.erreur}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {tour.texte}
                        {!tour.termine && (
                          <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-iris" />
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
