import { useEffect } from 'react'
import { COULEURS, type Reglages } from '@shared/reglages'

/**
 * Suit le thème du système, et la gamme de couleur choisie.
 *
 * Electron répercute le réglage Windows sur `prefers-color-scheme` : il suffit
 * de poser la classe `dark` que Tailwind attend. Sans elle, la fenêtre de
 * réglages restait blanche pendant que l'overlay, lui, était sombre.
 *
 * La couleur, elle, tient en deux variables posées sur `<html>` : toutes les
 * nuances d'`iris` en découlent (voir `styles/globals.css`). Le canvas de
 * l'anneau lit ses couleurs sur des sondes portant `text-iris`, donc il suit
 * sans rien connaître de tout ça.
 */
export function useSyncedTheme(): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const appliquer = (): void => {
      document.documentElement.classList.toggle('dark', media.matches)
    }
    appliquer()
    media.addEventListener('change', appliquer)
    return () => media.removeEventListener('change', appliquer)
  }, [])

  useEffect(() => {
    const poser = (r: Reglages): void => appliquerCouleur(r.couleur)
    void window.api.reglages().then(poser)
    // Changée dans les paramètres, la gamme se voit tout de suite dans les
    // trois fenêtres : elles écoutent toutes cette diffusion.
    return window.api.surReglages(poser)
  }, [])
}

/** Pose la gamme sur `<html>`. Exporté pour l'aperçu immédiat des paramètres. */
export function appliquerCouleur(couleur: keyof typeof COULEURS): void {
  const gamme = COULEURS[couleur] ?? COULEURS.iris
  document.documentElement.style.setProperty('--teinte', String(gamme.teinte))
  document.documentElement.style.setProperty('--chroma', String(gamme.chroma))
}
