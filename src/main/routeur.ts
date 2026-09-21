/**
 * Le tri des demandes : quel modèle, et est-ce la suite du sujet en cours ?
 *
 * Deux décisions prises avant que Claude Code ne voie la question, parce
 * qu'elles déterminent quel processus la reçoit. Une question banale n'a pas à
 * attendre Opus, et « fais-moi un site B » n'a rien à faire dans la
 * conversation du site A : le contexte s'y encombre et Claude finit par
 * confondre les deux.
 *
 * Le tri passe par Groq, déjà là pour la transcription : quelques dixièmes de
 * seconde, et gratuit dans les limites de son offre. S'il ne répond pas à
 * temps, des règles simples prennent le relais : le tri ne doit jamais retarder
 * la réponse de plus d'une seconde.
 */

export type Modele = 'haiku' | 'sonnet' | 'opus'

export type Choix = {
  modele: Modele
  /** Même sujet que l'échange précédent : on continue sa conversation. */
  suite: boolean
  /** D'où vient la décision, pour le journal. */
  source: 'voix' | 'groq' | 'regles' | 'fenetre'
}

export type Contexte = {
  /** La question vient de l'écoute rouverte juste après une réponse. */
  enSuite: boolean
  /** Le dernier échange, s'il y en a un. */
  precedent: { question: string; reponse: string; fin: number } | null
  cleGroq: string
}

/** Au-delà, un nouvel appel est un nouveau sujet, quoi qu'il dise. */
const OUBLI = 15 * 60 * 1000
/** Ce qu'on accorde à Groq avant de trier sans lui. */
const DELAI_GROQ = 1200

/**
 * Modèles essayés chez Groq, du plus pertinent au plus sûr. Leur catalogue
 * bouge : un modèle retiré répond 404, on passe au suivant et on s'en
 * souvient pour la suite de la session.
 */
const MODELES_GROQ = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b']
let modeleGroq = 0

/** Minuscules et sans accents : les règles comparent la forme, pas l'orthographe. */
function plat(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Le modèle imposé à la voix. La transcription écrit « Haïku » comme elle
 * peut : « aiku », « aïko », « haiko » désignent le même.
 */
function modeleDemande(question: string): Modele | null {
  const q = plat(question)
  if (/\b(opus)\b/.test(q)) return 'opus'
  if (/\b(sonnet|sonnette)\b/.test(q)) return 'sonnet'
  if (/\b(h?ai[kc]o?u?|h?aiko)\b/.test(q) && /\b(prends|passe|avec|en|utilise|mode)\b/.test(q)) {
    return 'haiku'
  }
  return null
}

/** « Nouveau sujet », « autre chose » : Lucas change de conversation à la voix. */
function nouveauSujetDemande(question: string): boolean {
  return /\b(nouveau sujet|autre sujet|change de sujet|rien a voir|autre chose|oublie ca|on passe a autre chose)\b/.test(
    plat(question)
  )
}

/**
 * Le tri sans Groq. Grossier, mais il se trompe du bon côté : dans le doute,
 * Sonnet, qui sait tout faire correctement.
 */
export function trierParRegles(question: string): Modele {
  const q = plat(question)
  const faire =
    /\b(cree|creer|creez|fais|faire|developpe|code|coder|programme|construis|monte|genere|corrige|debogue|repare|refais|refactorise|ajoute|modifie|installe|deploie|publie)\b/
  const ouvrage =
    /\b(app|appli|application|site|outil|script|page|composant|projet|plugin|extension|jeu|bouton|fonction|bug|code|api|serveur|base de donnees|maquette)\b/
  const ampleur =
    /\b(de zero|from scratch|refonte|architecture|complet|complete|entier|entiere|plateforme|gros projet|tout un|toute une|saas|backend)\b/

  if (faire.test(q) && ouvrage.test(q)) {
    return ampleur.test(q) || q.split(/\s+/).length > 45 ? 'opus' : 'sonnet'
  }
  // Une action simple sur le PC (ouvrir, lancer, chercher, ranger) ou une
  // question : Haiku sait appeler un outil, et il le fait vite.
  return 'haiku'
}

const CONSIGNE_TRI = `Tu tries les demandes vocales faites à Iris, une assistante qui pilote un PC Windows avec Claude Code.
Réponds UNIQUEMENT en JSON : {"niveau": "simple" | "outil" | "chantier", "suite": true | false}

niveau :
- "simple" : question, conversation, action rapide sur le PC (ouvrir une appli, un site, chercher un fichier, régler quelque chose).
- "outil" : créer, modifier ou corriger du code, un fichier structuré, un petit outil ou une page.
- "chantier" : une application ou un site complet, une refonte, une architecture, un travail de plusieurs heures humaines.

suite : true si la nouvelle demande continue le sujet de l'échange précédent (elle y fait référence, le complète, le corrige, dit « ça », « le », « ajoute… »). false si elle parle d'autre chose, ou s'il n'y a pas d'échange précédent.`

const NIVEAUX: Record<string, Modele> = { simple: 'haiku', outil: 'sonnet', chantier: 'opus' }

async function trierParGroq(
  question: string,
  contexte: Contexte
): Promise<{ modele: Modele; suite: boolean } | null> {
  if (!contexte.cleGroq.startsWith('gsk_')) return null

  const precedent = contexte.precedent
    ? `Échange précédent :\nLucas : ${contexte.precedent.question.slice(0, 400)}\nIris : ${contexte.precedent.reponse.slice(0, 400)}`
    : "Pas d'échange précédent."

  while (modeleGroq < MODELES_GROQ.length) {
    const controleur = new AbortController()
    const minuterie = setTimeout(() => controleur.abort(), DELAI_GROQ)
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${contexte.cleGroq}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODELES_GROQ[modeleGroq],
          temperature: 0,
          max_tokens: 40,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: CONSIGNE_TRI },
            { role: 'user', content: `${precedent}\n\nNouvelle demande : ${question}` }
          ]
        }),
        signal: controleur.signal
      })
      // Modèle retiré du catalogue : on passe au suivant, pour de bon.
      if (res.status === 404 || res.status === 400) {
        modeleGroq++
        continue
      }
      if (!res.ok) return null
      const corps = await res.json()
      const brut = JSON.parse(corps?.choices?.[0]?.message?.content ?? '{}')
      const modele = NIVEAUX[String(brut.niveau)]
      if (!modele) return null
      return { modele, suite: brut.suite === true }
    } catch {
      // Délai dépassé ou réseau absent : les règles s'en chargent.
      return null
    } finally {
      clearTimeout(minuterie)
    }
  }
  return null
}

/** Trie une demande. Ne rejette jamais : au pire, les règles décident. */
export async function trier(question: string, contexte: Contexte): Promise<Choix> {
  const impose = modeleDemande(question)
  const recent =
    !!contexte.precedent && Date.now() - contexte.precedent.fin < OUBLI && !nouveauSujetDemande(question)

  // Réponse donnée dans la fenêtre d'écoute qui suit une réponse d'Iris :
  // c'est la suite, par construction. Reste à choisir le modèle.
  if (contexte.enSuite && recent) {
    const groq = impose ? null : await trierParGroq(question, contexte)
    return {
      modele: impose ?? groq?.modele ?? trierParRegles(question),
      suite: true,
      source: impose ? 'voix' : 'fenetre'
    }
  }

  const groq = await trierParGroq(question, contexte)
  if (groq) {
    return { modele: impose ?? groq.modele, suite: recent && groq.suite, source: impose ? 'voix' : 'groq' }
  }
  return {
    modele: impose ?? trierParRegles(question),
    // Sans Groq, on ne juge le lien entre deux demandes que sur les tournures
    // qui ne se comprennent pas seules (« et ajoute… », « change-le »). Dans le
    // doute, un nouveau sujet : un contexte mêlé est pire qu'un oubli.
    suite: recent && /^(et |puis |ajoute|enleve|retire|change|modifie|corrige|mets|rends|refais|fais-le|fais le)/.test(plat(question).trim()),
    source: impose ? 'voix' : 'regles'
  }
}
