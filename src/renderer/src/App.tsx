import Activite from './pages/Activite'
import Bienvenue from './pages/Bienvenue'
import Conversation from './pages/Conversation'
import Overlay from './pages/Overlay'
import Parametres from './pages/Parametres'

/**
 * Les trois fenêtres partagent le même paquet et se distinguent par l'URL.
 * La page est lue à l'import, pas dans un effet : passer par un état affichait
 * l'overlay une image avant la bonne page.
 */
const page = new URLSearchParams(window.location.search).get('page')

// L'overlay ne défile jamais. Sa fenêtre change de taille pendant les
// transitions, et un contenu encore à l'ancienne taille y faisait apparaître
// des barres de défilement le temps d'une image.
if (
  page !== 'conversation' &&
  page !== 'parametres' &&
  page !== 'bienvenue' &&
  page !== 'activite'
) {
  document.documentElement.style.overflow = 'hidden'
}

export default function App(): JSX.Element {
  if (page === 'activite') return <Activite />
  if (page === 'bienvenue') return <Bienvenue />
  if (page === 'conversation') return <Conversation />
  if (page === 'parametres') return <Parametres />
  return <Overlay />
}
