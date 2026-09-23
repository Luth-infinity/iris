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
/**
 * Ce qu'on accorde à Groq avant de trier sans lui.
 *
 * Mesuré chez Lucas : 5,5 secondes en moyenne avant le premier mot d'Iris.
 * Cette attente-là est payée à chaque demande, pour une décision que les
 * règles prennent presque toujours pareil — on la raccourcit, et on s'en
 * passe quand elles sont sûres d'elles.
 */
const DELAI_GROQ = 700

/**
 * Modèles essayés chez Groq, du plus rapide au plus sûr. Leur catalogue bouge
 * vite : les Llama qui étaient en tête ont disparu (404) le 23/09/2026, et
 * chaque session recommençait par un aller-retour perdu. Un modèle retiré
 * répond 404, on passe au suivant et on s'en souvient pour la session.
 */
const MODELES_GROQ = ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b']
let modeleGroq = 0

/**
 * Ces modèles-là « réfléchissent » avant de répondre, et leur réflexion
 * consomme le budget de jetons : avec `max_tokens` serré, la réponse revenait
 * **vide**. On coupe la réflexion quand c'est possible et on laisse de la
 * marge — mesuré sur quinze phrases de congé : qwen répond juste à toutes en
 * 87 ms, gpt-oss se trompe deux fois et met quatre fois plus de temps.
 */
const SANS_REFLEXION = { reasoning_effort: 'none' as const, max_tokens: 200 }

/**
 * Cette phrase clôt-elle l'échange ?
 *
 * Une liste de formules ne suffit pas : on ne dit pas deux fois la même chose
 * pour prendre congé (« ah nickel c'est bon merci », « ok ça me va », « bon
 * ben super alors »). Un petit modèle juge la phrase entière, avec ce
 * qu'Iris venait de dire — c'est la même clé Groq que la transcription, et
 * ça se compte en centièmes de seconde.
 *
 * On ne demande que pour les phrases courtes dites juste après une réponse :
 * ailleurs, le doute coûterait une demande perdue. En cas d'échec, `null` :
 * l'appelant garde alors sa liste de formules, et dans le doute on répond.
 */
export async function estFinDEchange(
  question: string,
  contexte: { cleGroq: string; precedent: { question: string; reponse: string } | null }
): Promise<boolean | null> {
  if (!contexte.cleGroq.startsWith('gsk_')) return null
  // Au-delà, c'est une phrase qui dit quelque chose, pas un au revoir.
  if (question.trim().split(/\s+/).length > 12) return false

  const avant = contexte.precedent
    ? `Iris venait de dire : ${contexte.precedent.reponse.slice(0, 300)}`
    : "Iris venait de répondre."

  try {
    return await interrogerGroq(contexte.cleGroq, CONSIGNE_FIN, `${avant}\n\nIl répond : ${question}`)
  } catch {
    // Délai dépassé ou réseau absent : on ne devine pas, on répond.
    return null
  }
}

/**
 * Pose la question de la clôture, en descendant la liste des modèles quand
 * l'un d'eux a disparu du catalogue.
 */
async function interrogerGroq(
  cle: string,
  consigne: string,
  message: string
): Promise<boolean | null> {
  while (modeleGroq < MODELES_GROQ.length) {
    const controleur = new AbortController()
    const minuterie = setTimeout(() => controleur.abort(), DELAI_GROQ)
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODELES_GROQ[modeleGroq],
          temperature: 0,
          ...SANS_REFLEXION,
          messages: [
            { role: 'system', content: consigne },
            { role: 'user', content: message }
          ]
        }),
        signal: controleur.signal
      })
      if (res.status === 404 || res.status === 400) {
        modeleGroq++
        continue
      }
      if (!res.ok) return null
      const corps = await res.json()
      const mot = String(corps?.choices?.[0]?.message?.content ?? '')
        .trim()
        .toUpperCase()
      if (mot.includes('FIN')) return true
      if (mot.includes('SUITE')) return false
      return null
    } finally {
      clearTimeout(minuterie)
    }
  }
  return null
}

const CONSIGNE_FIN = `Tu écoutes une conversation entre quelqu'un et son assistante vocale.
L'assistante vient de répondre. Décide si la phrase suivante CLÔT l'échange (remerciement, approbation, congé, rien de plus à faire) ou si elle attend encore quelque chose (demande, question, précision, refus qui appelle une suite).
Réponds par un seul mot : FIN ou SUITE.

Exemples :
« ah nickel c'est bon merci » → FIN
« merci beaucoup, bonne soirée » → FIN
« ok ça me va » → FIN
« parfait » → FIN
« c'est tout bon de mon côté » → FIN
« super, tu peux l'ouvrir ? » → SUITE
« parfait, maintenant range-les » → SUITE
« non, pas celui-là » → SUITE
« attends » → SUITE
« ah mais c'est pas ce que je voulais » → SUITE
« oui » → SUITE`

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
  // Les verbes sont écrits avec leurs terminaisons : « installe » ne
  // reconnaissait pas « installer », et « tu peux installer l'app » partait sur
  // le plus petit modèle, qui répondait à côté.
  const faire =
    /\b(cre[ée]\w*|fais|faire|d[ée]veloppe\w*|code\w*|programme\w*|construi\w*|monte\w*|g[ée]n[èe]re\w*|corrige\w*|d[ée]bogue\w*|r[ée]pare\w*|refai\w*|refactorise\w*|ajoute\w*|modifie\w*|d[ée]ploie\w*|publie\w*)\b/
  // Toucher à la machine elle-même : installer un logiciel, régler un
  // périphérique, changer une configuration. C'est rarement une affaire de
  // deux commandes, et ça mérite mieux qu'une réponse expédiée.
  const machine =
    /\b(installe\w*|d[ée]sinstalle\w*|configure\w*|param[èe]tre\w*|r[ée]gle\w*|optimise\w*|am[ée]liore\w*|mets? [àa] jour|met\w* en place|branche\w*|connecte\w*|nettoie\w*|r[ée]pare\w*)\b/
  const ouvrage =
    /\b(app|appli|application|site|outil|script|page|composant|projet|plugin|extension|jeu|bouton|fonction|bug|code|api|serveur|base de donnees|maquette|micro|son|audio|casque|clavier|souris|[ée]cran|pilote|driver|logiciel|programme|windows|syst[èe]me|r[ée]glages?|param[èe]tres?)\b/
  const ampleur =
    /\b(de zero|from scratch|refonte|architecture|complet|complete|entier|entiere|plateforme|gros projet|tout un|toute une|saas|backend)\b/

  if (faire.test(q) && ouvrage.test(q)) {
    return ampleur.test(q) || q.split(/\s+/).length > 45 ? 'opus' : 'sonnet'
  }
  if (machine.test(q)) return 'sonnet'
  // Une action simple sur le PC (ouvrir, lancer, chercher, ranger) ou une
  // question : Haiku sait appeler un outil, et il le fait vite.
  return 'haiku'
}

const CONSIGNE_TRI = `Tu tries les demandes vocales faites à Iris, une assistante qui pilote un ordinateur avec Claude Code.
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
    ? `Échange précédent :\nUtilisateur : ${contexte.precedent.question.slice(0, 400)}\nIris : ${contexte.precedent.reponse.slice(0, 400)}`
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
          ...SANS_REFLEXION,
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
  // c'est la suite, par construction. Reste à choisir le modèle — et si les
  // règles voient une vraie action, inutile de demander à qui que ce soit.
  if (contexte.enSuite && recent) {
    const regles = trierParRegles(question)
    if (impose || regles !== 'haiku') {
      return { modele: impose ?? regles, suite: true, source: impose ? 'voix' : 'regles' }
    }
    const groq = await trierParGroq(question, contexte)
    return { modele: groq?.modele ?? regles, suite: true, source: 'fenetre' }
  }

  // Nouvel appel, mais les règles reconnaissent un chantier : le modèle ne
  // fait aucun doute, et seule la continuité resterait à trancher — or un
  // nouvel appel après une pause est presque toujours un nouveau sujet.
  const regles = trierParRegles(question)
  if (regles === 'opus' && !impose) {
    return { modele: 'opus', suite: false, source: 'regles' }
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
