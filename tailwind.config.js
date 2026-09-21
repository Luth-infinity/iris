/** @type {import('tailwindcss').Config} */
const { join } = require('path')

// Les variables ne portent que les composantes oklch : on reconstruit la
// fonction ici pour que Tailwind puisse y glisser `<alpha-value>` et garder
// les modificateurs d'opacité (`bg-iris/10`).
const teinte = (nom) => `oklch(var(--${nom}) / <alpha-value>)`

module.exports = {
  darkMode: ['class'],
  // Chemin absolu : Tailwind résout les motifs relatifs depuis le dossier
  // d'où la commande est lancée, et ne trouve plus rien dès qu'on construit
  // depuis le dossier parent.
  content: [join(__dirname, 'src/renderer/**/*.{ts,tsx,html}')],
  theme: {
    extend: {
      colors: {
        border: teinte('border'),
        input: teinte('input'),
        ring: teinte('ring'),
        background: teinte('background'),
        foreground: teinte('foreground'),
        positive: teinte('positive'),
        primary: {
          DEFAULT: teinte('primary'),
          foreground: teinte('primary-foreground')
        },
        secondary: {
          DEFAULT: teinte('secondary'),
          foreground: teinte('secondary-foreground')
        },
        destructive: {
          DEFAULT: teinte('destructive'),
          foreground: teinte('destructive-foreground')
        },
        muted: {
          DEFAULT: teinte('muted'),
          foreground: teinte('muted-foreground')
        },
        accent: {
          DEFAULT: teinte('accent'),
          foreground: teinte('accent-foreground')
        },
        card: {
          DEFAULT: teinte('card'),
          foreground: teinte('card-foreground')
        },
        // La couleur propre de l'application : l'iris. Elle ne sert qu'aux
        // états vivants (écoute, réflexion, parole), jamais aux surfaces.
        iris: {
          DEFAULT: teinte('iris'),
          foreground: teinte('iris-foreground'),
          soft: teinte('iris-soft')
        },
        // Surfaces de l'application : voir la note dans globals.css.
        shell: {
          DEFAULT: teinte('shell'),
          raised: teinte('shell-raised'),
          border: teinte('shell-border'),
          foreground: teinte('shell-foreground'),
          muted: teinte('shell-muted')
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)'
      },
      keyframes: {
        // Halo qui s'échappe de l'orbe pendant l'écoute.
        ripple: {
          '0%': { transform: 'scale(1)', opacity: '0.5' },
          '100%': { transform: 'scale(2.4)', opacity: '0' }
        },
        // Attente : une bande claire qui traverse le texte, plus discrète
        // qu'un clignotement.
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' }
        },
        // Repos : l'orbe respire au lieu de rester figée. C'est le seul signe
        // que l'application est vivante quand elle n'a rien à faire.
        respire: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.06)', opacity: '1' }
        },
        // Réflexion : un anneau qui tourne autour de l'orbe.
        tourne: {
          to: { transform: 'rotate(360deg)' }
        },
        // Iris apparaît devant soi. L'échelle part d'assez bas pour qu'on la
        // voie arriver, sans le rebond qui ferait gadget.
        arrivee: {
          from: { opacity: '0', transform: 'scale(0.9)' },
          to: { opacity: '1', transform: 'none' }
        },
        // Une bulle de tâche glisse depuis la pastille, à droite.
        bulle: {
          from: { opacity: '0', transform: 'translateX(10px) scale(0.96)' },
          to: { opacity: '1', transform: 'none' }
        },
        // Elle s'efface avant que la fenêtre change de taille et de place.
        retrait: {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'scale(0.88)' }
        }
      },
      animation: {
        ripple: 'ripple 1.6s ease-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        'fade-up': 'fade-up 160ms ease-out',
        respire: 'respire 3.2s ease-in-out infinite',
        tourne: 'tourne 1.1s linear infinite',
        arrivee: 'arrivee 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        // `both` : la bulle reste invisible pendant son délai de cascade.
        bulle: 'bulle 260ms cubic-bezier(0.2, 0.9, 0.3, 1) both',
        retrait: 'retrait 150ms ease-in forwards'
      }
    }
  },
  plugins: []
}
