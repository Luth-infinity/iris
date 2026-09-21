import { useEffect } from 'react'

/**
 * Suit le thème du système.
 *
 * Electron répercute le réglage Windows sur `prefers-color-scheme` : il suffit
 * de poser la classe `dark` que Tailwind attend. Sans elle, la fenêtre de
 * réglages restait blanche pendant que l'overlay, lui, était sombre.
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
}
