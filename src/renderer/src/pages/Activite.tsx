import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useSyncedTheme } from '@renderer/lib/theme'
import { cn } from '@renderer/lib/utils'

/**
 * Ce qu'Iris a fait, jour par jour.
 *
 * Elle tient un journal dans sa mémoire et des fiches par projet, mais
 * personne ne les voyait jamais : ils vivaient dans un dossier caché. Une
 * assistante qui agit vraiment sur la machine doit pouvoir répondre de ce
 * qu'elle a fait, et il faut que ça se lise sans ouvrir un fichier texte.
 *
 * La page ne rend pas du Markdown complet : le journal n'a que des titres de
 * jour et des lignes à puces, et y brancher une bibliothèque pour ça serait
 * hors de proportion.
 */

type Activite = {
  /** Les jours, du plus récent au plus ancien. */
  jours: { titre: string; lignes: string[] }[]
  /** Les fiches par projet : nom, résumé, dernières lignes. */
  fiches: { nom: string; lignes: string[] }[]
  dossier: string
}

export default function Activite(): JSX.Element {
  useSyncedTheme()

  const [activite, setActivite] = useState<Activite | null>(null)

  const charger = useCallback(async (): Promise<void> => {
    setActivite(await window.api.activite())
  }, [])

  useEffect(() => {
    void charger()
    // Rechargé à chaque ouverture : elle a pu travailler entre-temps.
    return window.api.surActiviteAffichee(() => void charger())
  }, [charger])

  const vide = activite && !activite.jours.length && !activite.fiches.length

  return (
    <div className="flex h-full flex-col bg-shell text-shell-foreground">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-shell-border px-5 py-3">
        <h1 className="text-[15px] font-medium">Ce qu’elle a fait</h1>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" title="Actualiser" onClick={() => void charger()}>
          <RefreshCw className={cn('h-3.5 w-3.5', !activite && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Ouvrir le dossier"
          onClick={() => window.api.ouvrirMemoire()}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {vide && (
          <p className="text-[13px] leading-relaxed text-shell-muted">
            Rien pour le moment. Dès qu’elle range, écrit ou installe quelque chose, elle le note
            ici.
          </p>
        )}

        {activite?.jours.map((jour) => (
          <section key={jour.titre} className="space-y-2">
            <h2 className="text-[13px] font-medium">{jour.titre}</h2>
            <ul className="space-y-1.5">
              {jour.lignes.map((ligne, i) => (
                <li
                  key={i}
                  className="rounded-md border border-shell-border px-3 py-2 text-[13px] leading-relaxed"
                >
                  {ligne}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {!!activite?.fiches.length && (
          <section className="space-y-3 border-t border-shell-border pt-5">
            <h2 className="text-[13px] font-medium">Par projet</h2>
            {activite.fiches.map((fiche) => (
              <div key={fiche.nom} className="space-y-1.5">
                <h3 className="text-[13px] text-shell-muted">{fiche.nom}</h3>
                <ul className="space-y-1">
                  {fiche.lignes.map((ligne, i) => (
                    <li key={i} className="text-[12px] leading-relaxed text-shell-muted">
                      {ligne}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
