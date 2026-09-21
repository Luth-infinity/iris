import { BasculeLangue } from './bascule-langue';
import { Reveal } from './reveal';
import type { Contenu, Langue } from './content';
import { getReleases, getTelechargements, PAGE_VERSIONS, type Telechargements } from './releases';

const DEPOT = 'https://github.com/Luth-infinity/iris';
const SUITE = 'https://luth-apps.vercel.app';
const CLE_GROQ = 'https://console.groq.com/keys';

// Les deux langues restent dans cet ordre quelle que soit la page : c'est la
// marque qui se déplace, pas les libellés.
const LANGUES: { code: Langue; libelle: string; href: string }[] = [
  { code: 'fr', libelle: 'FR', href: '/fr' },
  { code: 'en', libelle: 'EN', href: '/' }
];

/** Dans l'ordre de la page : on retombe dans l'autre langue sur celle qu'on lisait. */
const SECTIONS = ['echange', 'couts', 'details', 'telecharger', 'versions'];

// ─── Fragments ──────────────────────────────────────────────────────────────

/** Le glyphe de l'icône, en une couleur : l'anneau ouvert et son noyau. */
function Glyphe({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path
        d="M16 5.5A10.5 10.5 0 1 0 26.5 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4.6" fill="currentColor" />
    </svg>
  );
}

// Rythme figé plutôt qu'aléatoire : une valeur tirée au rendu diffèrerait
// entre le serveur et le navigateur, et React signalerait la divergence.
const RYTHME = [
  0.42, 0.71, 0.35, 0.88, 0.55, 0.24, 0.63, 0.94, 0.48, 0.31, 0.77, 0.59, 0.86, 0.4, 0.68, 0.27,
  0.81, 0.52, 0.36, 0.73, 0.45, 0.9, 0.38, 0.66, 0.29, 0.84, 0.5, 0.75, 0.33, 0.61, 0.92, 0.44
];

/**
 * L'anneau, tel qu'Iris le dessine : une couronne de traits qui suit la voix.
 * C'est sa signature à l'écran, et ce qu'une capture figée ne montrerait pas.
 */
function Anneau({
  taille,
  traits,
  longueur,
  epaisseur = 2
}: {
  taille: number;
  traits: number;
  longueur: number;
  epaisseur?: number;
}) {
  const rayon = taille / 2 - longueur;
  return (
    <div className="anneau" style={{ width: taille, height: taille }} aria-hidden>
      {Array.from({ length: traits }, (_, i) => {
        const v = RYTHME[i % RYTHME.length];
        return (
          <span
            key={i}
            className="trait"
            style={
              {
                '--angle': `${(360 / traits) * i + 180}deg`,
                '--rayon': `${rayon}px`,
                '--longueur': `${longueur}px`,
                '--epaisseur': `${epaisseur}px`,
                '--duree': `${(0.8 + v * 0.9).toFixed(2)}s`,
                '--delai': `${(-v * 2).toFixed(2)}s`
              } as React.CSSProperties
            }
          >
            <span />
          </span>
        );
      })}
    </div>
  );
}

/** Le noyau de l'orbe, au centre de l'anneau. */
function Noyau({ className }: { className: string }) {
  return (
    <span
      className={`absolute rounded-full bg-[radial-gradient(circle_at_36%_30%,#ffffff,#c9cbd1)] shadow-[0_0_28px_rgba(255,255,255,0.35)] ${className}`}
    />
  );
}

/**
 * La barre, rejouée en HTML : la nappe de lumière, l'anneau qui suit la voix,
 * une phrase. C'est tout ce qu'Iris montre quand on l'appelle.
 */
function Barre({ t }: { t: Contenu }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-nuit px-6 pb-9 pt-10 text-white shadow-[0_40px_80px_-30px_rgba(0,0,0,0.55)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.09),transparent_60%)]" />
      <div className="relative flex flex-col items-center">
        <div className="relative grid place-items-center">
          <Anneau taille={188} traits={72} longueur={26} />
          <Noyau className="size-14" />
        </div>
        <p className="mt-6 text-[17px]">{t.barre.phrase}</p>
        <p className="mt-1.5 text-xs text-nuit-soft">
          <span className="font-mono tabular-nums">0:03</span> · {t.barre.aide}
        </p>
      </div>
    </div>
  );
}

/**
 * La pastille au bord de l'écran, et sa liste de tâches en bulles. Les
 * libellés restent en français dans les deux langues : c'est ce qu'Iris
 * affiche.
 */
function Pastille({ t }: { t: Contenu }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-line bg-canvas">
      {/* Un bout de bureau : la pastille n'a de sens qu'au bord d'un écran. */}
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
        <span className="size-2.5 rounded-full bg-line" />
      </div>
      <div className="flex min-h-[250px] items-center justify-end gap-3 py-8 pr-5 pl-6">
        <ul className="flex flex-col items-end gap-2">
          {t.echange.taches.map((tache, i) => (
            <li
              key={tache.libelle}
              className={`flex items-center gap-2 rounded-full bg-nuit px-3 py-1.5 text-[12px] text-white shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)] ${
                tache.etat === 'fait' ? 'opacity-55' : ''
              }`}
            >
              {tache.etat === 'fait' ? (
                <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
                  <path
                    d="M2.5 6.2l2.3 2.3 4.7-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : tache.etat === 'cours' ? (
                <span className="tourne size-3 rounded-full border-[1.5px] border-white/25 border-t-white" />
              ) : (
                <span className="size-3 rounded-full border-[1.5px] border-white/35" />
              )}
              <span className="text-nuit-soft">Tâche {i + 1}</span>
              <span>{tache.libelle}</span>
            </li>
          ))}
        </ul>
        <div className="relative grid size-[72px] flex-shrink-0 place-items-center rounded-full border border-nuit-line bg-nuit shadow-[0_4px_14px_rgba(0,0,0,0.35)]">
          <span className="comete absolute inset-1.5 rounded-full border-2 border-transparent border-t-white/80" />
          <Anneau taille={60} traits={36} longueur={7} epaisseur={1.5} />
          <Noyau className="size-5" />
        </div>
      </div>
    </div>
  );
}

function BoutonTelecharger({ t, dl }: { t: Contenu; dl: Telechargements }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <a
        href={dl.win ?? PAGE_VERSIONS}
        className="inline-flex items-center gap-2.5 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-page transition hover:opacity-85"
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path
            fill="currentColor"
            d="M1 2.6l5.7-.8v5.5H1V2.6zm0 10.8l5.7.8V8.7H1v4.7zm6.4.9L15 15.4V8.7H7.4v5.6zm0-12.6v5.6H15V.6L7.4 1.7z"
          />
        </svg>
        {t.telecharger.windows}
      </a>
      <span className="text-sm text-ink-soft">
        {dl.version && (
          <>
            {t.telecharger.version} {dl.version} ·{' '}
          </>
        )}
        <a href={PAGE_VERSIONS} className="underline-offset-4 hover:text-ink hover:underline">
          {t.telecharger.toutes}
        </a>
      </span>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function Vitrine({ t, locale }: { t: Contenu; locale: Langue }) {
  const [dl, releases] = await Promise.all([getTelechargements(), getReleases(locale)]);

  return (
    <>
      <Reveal />

      <header className="sticky top-0 z-10 border-b border-line/80 bg-page/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-5 px-5 py-3">
          <span className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <Glyphe />
            Iris
          </span>
          <span className="flex-1" />
          <a href="#echange" className="hidden text-sm text-ink-soft hover:text-ink sm:block">
            {t.nav.echange}
          </a>
          <a href="#versions" className="hidden text-sm text-ink-soft hover:text-ink sm:block">
            {t.nav.versions}
          </a>
          <BasculeLangue
            langues={LANGUES}
            locale={locale}
            label={t.nav.langue}
            sections={SECTIONS}
            fond="bg-canvas ring-1 ring-line"
            pastille="bg-page ring-1 ring-line shadow-sm"
          />
          <a href="#telecharger" className="text-sm font-medium hover:opacity-70">
            {t.nav.telecharger}
          </a>
        </nav>
      </header>

      <main>
        {/* Hero : le texte à gauche, la barre telle qu'elle apparaît à droite. */}
        <section className="px-5 pb-24 pt-16 sm:pt-24">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <h1 className="reveal headline text-[12vw] sm:text-[68px] lg:text-[76px]">
                {t.hero.titre[0]}
                <br />
                <span className="text-ink-soft">{t.hero.titre[1]}</span>
              </h1>
              <p className="reveal mt-7 max-w-[50ch] text-[17px] leading-relaxed text-ink-soft">
                {t.hero.texte}
              </p>
              <div className="reveal mt-10">
                <BoutonTelecharger t={t} dl={dl} />
              </div>
              <p className="reveal mt-5 text-sm text-ink-soft">{t.hero.mention}</p>
            </div>
            <div className="reveal mx-auto w-full max-w-[440px]">
              <Barre t={t} />
            </div>
          </div>
        </section>

        {/* L'échange, en trois temps, avec la pastille qui montre le travail. */}
        <section id="echange" className="scroll-mt-20 px-5 py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="reveal headline max-w-[18ch] text-[40px] sm:text-[54px]">
              {t.echange.titre}
            </h2>
            <div className="mt-14 grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
              <ol className="grid gap-9">
                {t.echange.temps.map((temps, i) => (
                  <li key={temps.titre} className="reveal grid grid-cols-[2.25rem_1fr] gap-x-3">
                    <span className="headline pt-0.5 text-[22px] text-ink-soft">{i + 1}</span>
                    <div>
                      <h3 className="text-[19px] font-semibold tracking-tight">{temps.titre}</h3>
                      <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
                        {temps.texte}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="reveal">
                <Pastille t={t} />
              </div>
            </div>
          </div>
        </section>

        {/* Ce qui la rend possible : trois briques, aucune facturée à l'appel. */}
        <section id="couts" className="scroll-mt-20 px-5 py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="reveal headline text-[40px] sm:text-[54px]">{t.couts.titre}</h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-3">
              {t.couts.items.map((item) => (
                <div key={item.role} className="reveal bg-page p-7">
                  <p className="text-sm text-ink-soft">{item.role}</p>
                  <h3 className="headline mt-3 text-[28px]">{item.titre}</h3>
                  <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{item.texte}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Détails */}
        <section id="details" className="scroll-mt-20 px-5 py-12">
          <div className="mx-auto grid max-w-6xl gap-x-10 gap-y-11 sm:grid-cols-2 lg:grid-cols-3">
            {t.details.map((d) => (
              <div key={d.titre} className="reveal border-t border-ink pt-5">
                <h3 className="text-[17px] font-semibold tracking-tight">{d.titre}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{d.texte}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Téléchargement et ce qu'il faut avant. */}
        <section id="telecharger" className="scroll-mt-20 px-5 py-24">
          <div className="reveal mx-auto max-w-6xl rounded-[32px] bg-nuit px-7 py-14 text-white sm:px-12">
            <div className="flex items-center gap-4">
              <Glyphe className="size-9" />
              <h2 className="headline text-[40px] sm:text-[52px]">{t.telecharger.titre}</h2>
            </div>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {t.telecharger.prerequis.map((p, i) => (
                <li key={p.titre} className="border-t border-nuit-line pt-5">
                  <span className="font-mono text-xs text-nuit-soft">0{i + 1}</span>
                  <h3 className="mt-2 text-[17px] font-semibold tracking-tight">{p.titre}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-nuit-soft">{p.texte}</p>
                </li>
              ))}
            </ol>
            <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-4">
              <a
                href={dl.win ?? PAGE_VERSIONS}
                className="inline-flex items-center gap-2.5 rounded-full bg-white px-6 py-3 text-[15px] font-medium text-nuit transition hover:opacity-85"
              >
                {t.telecharger.windows}
              </a>
              <a
                href={CLE_GROQ}
                className="text-sm text-nuit-soft underline-offset-4 hover:text-white hover:underline"
              >
                {t.telecharger.cle} →
              </a>
              {dl.version && (
                <span className="text-sm text-nuit-soft">
                  {t.telecharger.version} {dl.version}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Versions, lues sur les releases GitHub. */}
        {releases.length > 0 && (
          <section id="versions" className="scroll-mt-20 px-5 py-8">
            <div className="mx-auto max-w-6xl">
              <h2 className="reveal headline text-[40px] sm:text-[54px]">{t.changelog.titre}</h2>
              <ul className="mt-12">
                {releases.map((release) => (
                  <li
                    key={release.version}
                    className="reveal grid gap-4 border-t border-line py-8 sm:grid-cols-[12rem_1fr]"
                  >
                    <div>
                      <a
                        href={release.page}
                        className="headline text-[26px] hover:opacity-70"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {release.version}
                      </a>
                      <p className="mt-1.5 text-sm text-ink-soft">{release.date}</p>
                    </div>
                    <ul className="grid gap-2.5">
                      {release.points.map((point) => (
                        <li key={point} className="max-w-[70ch] text-[15px] leading-relaxed text-ink-soft">
                          {point}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>

      <footer className="mt-16 border-t border-line px-5 py-12">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Glyphe className="size-4" />
            Iris
          </span>
          <span className="flex-1" />
          <a href={SUITE} className="text-sm text-ink-soft hover:text-ink">
            {t.pied.suite}
          </a>
          <a href={DEPOT} className="text-sm text-ink-soft hover:text-ink">
            {t.pied.code}
          </a>
          <a href={PAGE_VERSIONS} className="text-sm text-ink-soft hover:text-ink">
            {t.pied.versions}
          </a>
        </div>
      </footer>
    </>
  );
}
