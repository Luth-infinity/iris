import type { Metadata } from 'next';
import './globals.css';

// Les titres et descriptions sont posés par chaque page : celle-ci ne garde
// que ce qui vaut pour les deux langues.
export const metadata: Metadata = {
  metadataBase: new URL('https://iris-luth.vercel.app'),
  title: 'Iris',
  icons: { icon: '/icon.png' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* `suppressHydrationWarning` : le script plus bas ajoute une classe à
       <html> avant l'hydratation, ce que React signalerait sinon comme une
       divergence serveur / client. */
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Marque la page comme animable seulement si JS tourne : sans cela, un
            échec de script laisserait tout le contenu invisible. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js');" }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
