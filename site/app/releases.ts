import type { Langue } from './content';

const DEPOT = 'Luth-infinity/iris';
const API = `https://api.github.com/repos/${DEPOT}/releases`;

export const PAGE_VERSIONS = `https://github.com/${DEPOT}/releases`;

export type Release = {
  version: string;
  date: string;
  page: string;
  points: string[];
};

export type Telechargements = {
  version: string;
  win: string | null;
};

type ReleaseApi = {
  tag_name: string;
  published_at: string;
  html_url: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
};

/**
 * Les versions viennent des releases GitHub : le site se met à jour tout seul
 * à chaque publication, sans double saisie qui finirait par diverger.
 *
 * Revalidé toutes les dix minutes : à une heure, le journal affichait encore
 * l'avant-dernière version longtemps après sa publication. L'API anonyme de
 * GitHub plafonne à soixante appels par heure, ce rythme en consomme six.
 */
async function lire(): Promise<ReleaseApi[]> {
  try {
    const res = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 600 }
    });
    if (!res.ok) return [];
    const data = (await res.json()) as ReleaseApi[];
    return data.filter((r) => !r.draft && !r.prerelease);
  } catch {
    // Le site doit se construire même si l'API GitHub est indisponible.
    return [];
  }
}

/**
 * Isole la partie d'une note de version rédigée dans la langue voulue.
 *
 * Le corps publié sur GitHub porte les deux : le français d'abord, puis un
 * titre « ## English » et sa traduction. Une note écrite avant cette
 * convention n'a pas de section anglaise : on retombe alors sur le texte
 * disponible, mieux vaut du français lisible qu'un journal vide.
 */
function section(body: string, langue: Langue): string {
  const coupure = body.search(/^#{1,3}\s*English\s*$/im);
  if (coupure === -1) return body;
  return langue === 'en' ? body.slice(coupure) : body.slice(0, coupure);
}

/** Garde les puces et les phrases courtes, écarte les blocs d'installation. */
function resumer(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('**') && !l.startsWith('>'))
    .map((l) => l.replace(/^[-*]\s*/, ''))
    .filter((l) => l.length > 25)
    .slice(0, 4);
}

export async function getReleases(langue: Langue = 'fr'): Promise<Release[]> {
  return (await lire()).slice(0, 5).map((r) => ({
    version: r.tag_name.replace(/^v/, ''),
    date: new Date(r.published_at).toLocaleDateString(langue === 'en' ? 'en-GB' : 'fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }),
    page: r.html_url,
    points: resumer(section(r.body || '', langue))
  }));
}

/**
 * Le lien de téléchargement est lu sur la dernière release, jamais écrit à la
 * main : un numéro de version en dur dans la page finit toujours par pointer
 * vers un fichier supprimé. Sans installeur joint, le bouton renvoie vers la
 * page des versions plutôt que vers le vide.
 */
export async function getTelechargements(): Promise<Telechargements> {
  const derniere = (await lire())[0];
  if (!derniere) return { version: '', win: null };
  return {
    version: derniere.tag_name.replace(/^v/, ''),
    win: derniere.assets.find((a) => a.name.endsWith('.exe'))?.browser_download_url ?? null
  };
}
