# Iris — repères pour travailler sur ce dépôt

Assistante vocale de bureau : un raccourci global ouvre le micro, la voix part
en transcription, la question passe au **Claude Code installé sur la machine**,
et la réponse est lue à voix haute pendant qu'elle s'écrit. Elle vit dans la
zone de notification.

Le code et les commentaires sont **en français**. Les commentaires expliquent
*pourquoi*, pas *quoi*.

## La chaîne, dans l'ordre

1. `main/index.ts` — le raccourci bascule l'état et montre l'overlay.
2. `renderer/pages/Overlay.tsx` + `lib/micro.ts` — micro, niveau, transcription
   chez Groq (le code vient de VoiceType, où il a été éprouvé).
3. `main/cerveau.ts` — `claude -p --output-format stream-json`, NDJSON parsé au
   fil de l'eau, `session_id` conservé pour `--resume`.
4. `main/voix.ts` — chaque phrase terminée est synthétisée par l'endpoint de
   lecture à voix haute de Microsoft Edge.
5. `renderer/lib/lecture.ts` — l'overlay joue les MP3 dans l'ordre : le main n'a
   pas de sortie audio.

## Les deux formes de la barre

C'est une application **vocale**, pas une application de chat avec un micro
greffé dessus. La fenêtre `Conversation.tsx` est un **historique en lecture
seule**, qui ne s'ouvre que depuis le menu de l'icône : ni au démarrage, ni au
clic sur l'icône, ni depuis la barre. Lucas l'a refusée deux fois comme
« chat ». Au démarrage, Iris se montre un instant (`annoncer()`) et dit comment
l'appeler ; le clic gauche sur l'icône l'appelle, comme son nom.

L'overlay, lui, a deux formes (`shared/conversation.ts`) :

| | |
|---|---|
| `barre` | En face de soi, en bas de l'écran. La nappe de lumière, l'anneau à 196 px, une phrase. C'est l'échange : on parle, elle répond. |
| `pastille` | 88 px au bord droit de l'écran. Juste l'orbe et son anneau. C'est le travail long. |

Iris passe en pastille toute seule au bout de `AVANT_RETRAIT` sans un mot, et
revient en barre dès qu'elle a quelque chose à dire, à la fin du tour, ou d'un
clic sur la pastille (qui l'épingle jusqu'à la fin du tour). **Ne pas la
laisser en face pendant un travail de deux minutes** : c'est le reproche qui a
motivé les deux formes.

La fenêtre change de taille et de place, donc la transition n'est pas un
morphing CSS : `forme-part` déclenche la sortie, on déplace, `forme` déclenche
l'entrée. `setResizable` encadre le `setBounds` parce que Windows le borne sur
une fenêtre non redimensionnable.

## Apparaître et disparaître

`hide()` seul faisait « dépop » la barre en pleine phrase. `masquerOverlay()`
envoie `disparition`, laisse 210 ms à l'animation, puis cache — et ne cache
rien si un tour a repris entre-temps. `montrerOverlay()` envoie `apparition`,
qui annule une sortie commencée. Les courbes sont dans `tailwind.config.js`
(`arrivee` : monte de 14 px en 260 ms ; `retrait` : retombe en 200 ms).

## L'anneau

`components/anneau.tsx` est la signature visuelle, et la raison pour laquelle
Iris ne ressemble pas à VoiceType : une couronne de traits qui suit le
**spectre** de la voix, la nôtre à l'écoute et **la sienne quand elle parle**
(`lib/lecture.ts` branche la lecture sur un `AnalyserNode`). Sans spectre, elle
respire au repos et une comète en fait le tour au travail. Tout est peint dans
un canvas, et les couleurs sont lues sur des sondes invisibles portant
`text-iris` et `text-destructive` : le canvas ne connaît pas Tailwind.

## La veille — dire « Iris »

`renderer/lib/veille.ts`. Le petit modèle Vosk français en WebAssembly, rien ne
sort de la machine. Coché par défaut (réglages version 2 : les fichiers
antérieurs, restés à `false` par l'ancien défaut, sont rallumés une fois).

**Pas de grammaire restreinte.** Une grammaire `["iris", "[unk]"]` ramène
n'importe quelle parole vers le seul mot proposé : « Il fait beau aujourd'hui,
je vais sortir » réveillait Iris. Le modèle complet transcrit cette phrase mot
pour mot et ne dit « iris » que quand on le prononce. Mesuré dans `verif/` avec
des enregistrements (`?source=iris-henri`, `iris-denise`, `phrase-henri`,
`sans-mot`), à refaire avant toute modification de la veille.

- Le modèle (42 Mo) est dans `assets/veille/vosk-fr.tar.gz`, **l'archive garde
  son dossier racine** (`vosk-model-small-fr-0.22/`) — Vosk déballe avec
  `strip_first_component`.
- Le worker de Vosk réclame une URL : le main envoie les octets, le renderer en
  fait une URL d'objet. Un chemin de fichier et un protocole maison butent
  chacun sur un cas entre développement et paquet.
- **Import dynamique obligatoire** : Vosk embarque son WASM, soit 5,8 Mo. En
  import statique, les trois fenêtres le chargeaient au démarrage.
- **Une seule instance par fenêtre** (`Veille.partagee`) : React monte les
  effets deux fois en développement, et le modèle était déballé deux fois.
- **Le silence ne passe pas** : un seuil d'énergie décide, et la fin de la
  traîne clôt l'énoncé (`retrieveFinalResult`). Sans ça le partiel s'allonge en
  « [unk] [unk] [unk]… » indéfiniment.
- **C'est le dernier mot du partiel qui déclenche**, pas l'énoncé entier : on
  appelle Iris au milieu d'une phrase.
- **La veille se suspend dès qu'Iris n'est plus au repos** : sa propre voix
  dans les enceintes prononce son nom, et elle se rouvrirait le micro au milieu
  de sa phrase.

## Finir une demande sans clavier

Appelée à la voix, Iris doit se refermer à la voix. Trois sorties, toutes
mesurées dans `verif/` (`source=partage`, puis `window.iris_jouer('demande')`,
`'demande-cestbon'`, `'laisse-tomber'` et lecture de `window.__appels`) :

- **Le silence** (`Overlay.tsx`) : 2 s sans parole après avoir parlé envoie ;
  10 s sans rien dire range le micro ; 90 s maximum. Le seuil suit le bruit de
  fond de la pièce.
- **La voix** : pendant l'écoute, la veille passe en mode `commande`. Un énoncé
  qui *finit* par « c'est bon », « c'est tout », « merci »… envoie tout de
  suite ; un énoncé qui n'est *que* « laisse tomber », « stop », « annule »…
  annule. Les listes sont dans `lib/commandes.ts`, **à part de `veille.ts`**
  pour ne pas tirer Vosk dans le paquet commun. `lireDemande()` retire la
  formule finale avant l'envoi à l'agent.
- **Le clic** : l'orbe est un bouton, le même geste que le raccourci.

## Après la réponse

- **La conversation continue** (réglage `suite`) : quand elle a fini de parler,
  le micro se rouvre 6 s (`ATTENTE_SUITE`), sa réponse reste affichée, et on lui
  répond sans redire son nom. « Non », « ça ira », « c'est bon »… ferment.
- **Son nom l'interrompt pendant qu'elle parle** : la veille reste ouverte en
  `parole`, parce que l'annulation d'écho du micro retire déjà ce que le PC
  joue. C'est aussi pourquoi on ne peut pas tester la veille en faisant parler
  les enceintes : elle n'entend que des « [unk] ».
- **Un blanc dans la voix n'est pas la fin** (`Diseur.occupe`) : quand la
  synthèse est plus lente que la lecture, la file se vide entre deux phrases
  et `parole-finie` arrive trop tôt. Conclure là rouvrait le micro, puis
  l'écoute sans réponse repliait la barre **pendant qu'Iris parlait encore** :
  plus rien à l'écran pour savoir si on pouvait répondre (21/09). La fin ne
  vaut que si plus aucune phrase n'est en synthèse ; `syntheses-finies`
  rattrape le cas où la dernière synthèse échoue.
- **Un tour abandonné ne touche plus à rien** (`tourCourant`, `abandonnerTour`).
  Sans ce numéro, `poser()` reprenait la main après l'arrêt de l'agent et
  réécrivait l'état par-dessus l'écoute suivante.
- **Micro choisi introuvable → micro par défaut** (`flux()` dans `micro.ts`).
  L'identifiant enregistré ne désignait plus rien d'une session à l'autre, et
  la veille ne démarrait pas (`OverconstrainedError`).

## Les bulles de tâches

Ce qu'Iris fait se voit comme dans Claude Code : sa **liste de tâches**
(`TaskCreate` / `TaskUpdate`) s'affiche en bulles à gauche de la pastille,
« Tâche 2 · Installation des dépendances », avec un cercle vide, un anneau qui
tourne ou une coche. En face, une seule bulle : la tâche en cours, ou l'action
du moment. À la fin, « 3 tâches terminées ».

- `cerveau.ts` : `TaskCreate` ne connaît pas son numéro, il arrive dans le
  **résultat** (« Task #2 created »), donc on attend le message `user` qui
  porte le `tool_result`. `TaskUpdate` passe par `taskId` et `status`.
  L'événement `taches` envoie la liste entière à chaque changement.
- Les outils sont traduits (`decrireOutil` → `libelle`) : « Écrit a.txt »,
  « Lit … », la `description` de la commande quand l'agent en donne une.
  `ToolSearch` et les outils de tâches ne s'affichent pas comme des actions.
- La pastille fait 400 × 320 pour loger la colonne, **mais laisse passer les
  clics** (`setIgnoreMouseEvents(true, { forward: true })`) ; le renderer ne les
  reprend qu'au survol de l'orbe (canal `survol`).
- L'animation d'entrée garde son état final : l'opacité d'une tâche faite se
  pose sur un enfant, sinon l'animation l'écrase.
- La consigne demande de tenir la liste dès qu'un travail a plusieurs étapes.
  Pour trois fichiers, l'agent s'en passe, et c'est voulu.
- Tailwind 3 ne génère que les opacités de sa gamme (`/10`, `/15`…) : un `/12`
  ne produit **aucune** classe, sans erreur.

## Vitesse et choix du modèle

- **`routeur.ts`** trie chaque demande avant Claude Code : Haiku (question,
  action rapide), Sonnet (créer ou modifier un outil), Opus (chantier). Il
  décide aussi si c'est la **suite** du sujet ou un **nouveau** sujet. Groq
  d'abord (1,2 s maximum), des règles ensuite. Un modèle dit à la voix
  (« prends Opus ») l'emporte ; `modele: 'auto'` dans les réglages (version 3).
- **`cerveau.ts`** garde des Claude Code **lancés d'avance** (`--input-format
  stream-json`) : un Haiku et un Sonnet en réserve, et une conversation
  vivante par sujet. Mesuré : nouveau sujet 1,6 à 1,7 s avant le premier mot
  (contre ~6,4 s en relançant à chaque fois), suite du sujet 0,85 s, changement
  de modèle en cours de sujet 3,7 s (reprise par `--resume`).
- Un nouveau sujet part d'une conversation **vierge** : le site A ne pollue
  pas le site B. Le suivi d'un projet d'une fois à l'autre passe par son
  `CLAUDE.md`, pas par une conversation interminable.
- La consigne est passée **à chaque lancement**, reprise comprise : elle vit
  dans le processus, pas dans la session.
- Réglages changés : `invalider()` relance la réserve.

## Entendre ce qu'elle dit vraiment

Le texte prononcé n'est pas celui qui s'affiche (`pourLaVoix` passe entre les
deux) : quand Lucas dit « elle parle mal », la seule preuve utile est la
phrase envoyée à la synthèse. `Diseur` la consigne (`dit : …`) dans
`journal.log` — c'est la première chose à lire sur un défaut de voix.

Les phrases sont découpées pour l'oreille : plus de coupure sur les
deux-points, ni après une abréviation ou une initiale (`ABREGE`). Et la
lecture décode **la phrase suivante pendant la précédente**
(`FileLecture.suivante`) : sans ça, un blanc s'entendait entre deux phrases
d'une même réponse.

## Sa façon de parler

Lucas la trouvait « trop littérale » : elle lisait le nom d'un smiley, disait
« suite tiret essai point h t m l », citait ce qu'elle avait écrit. Deux
niveaux :

- **La consigne** (« Ta façon d'être », « Parler comme on parle ») : écrire pour
  l'oreille, pas de nom de fichier ni d'adresse ni de citation littérale,
  chaleureuse et vive sans formules plaquées, et **ne jamais parler de ses
  propres règles** : interdire les emojis la faisait expliquer « la voix les
  lirait », ce qui était pire. Elle peut en mettre, ils s'affichent.
- **`pourLaVoix()`** dans `voix.ts` rattrape le reste avant la synthèse, sans
  toucher au texte affiché. Les adresses passent **avant** le filtre des
  chemins (« https: » ressemble à « C: »). Ce qu'il fait, revu le 22/09 après
  « elle parle mal, elle dit des trucs comme sur point machin » :
  - **une adresse se dit par le nom du site**, jamais épelée :
    `iris-luth.vercel.app` → « iris luth » (l'hébergeur ne dit rien),
    `api.groq.com` → « groq », `youtube.com` → « youtube ». Avant, les
    sous-domaines et les points survivaient, d'où le bafouillage.
  - la ponctuation finale n'est plus avalée par l'adresse ;
  - un mail se dit « contact chez posidea » ;
  - `0.3.1` se dit « 0 point 3 point 1 », mais `1.5 Go` reste un nombre ;
  - `Ctrl+Maj+Espace` devient « Contrôle Majuscule Espace » ;
  - l'espace devant un point n'est retiré que si le point ferme vraiment la
    phrase : « le fichier .env » devenait « le fichier.env ».
  - Les cas sont rejoués dans `verif/` (`cas.mjs`) : c'est le seul moyen de
    voir ce que la voix dira vraiment.
- **Rien sans lettre ni chiffre n'est synthétisé** : « 😊. » devenait « . »,
  lu « point ». Les smileys en caractères (« :) », « ^^ », « <3 ») sont retirés.
- **Une question n'annule jamais** (`lireDemande`) : « ça va » figurait dans
  les refus, et « Ça va ? » refermait Iris sans réponse. Ce qui finit par
  « ? » passe tel quel.
- **Le ton** : l'endpoint gratuit d'Edge **refuse** le style « cheerful »
  (synthèse coupée net, vérifié). Seules la hauteur et le débit passent :
  réglage `ton` (Enjoué +6 %, par défaut ; Naturel ; Posé −3 %).

## La couleur et le son

**La couleur** ne tient qu'à deux variables posées sur `<html>` par
`lib/theme.ts` d'après les réglages : `--teinte` et `--chroma`. Toutes les
nuances d'`iris` en découlent dans `styles/globals.css` (une définition par
thème, pas une palette par gamme), et le canvas de l'anneau lit ses couleurs
sur des sondes portant `text-iris` : il suit sans rien savoir. Six gammes dans
`COULEURS` (`shared/reglages.ts`). Seuls les états vivants sont colorés ; une
surface teintée rendrait toute l'application colorée. L'icône, elle, reste
violette : c'est la marque.

**Le son du démarrage** est synthétisé, pas emprunté : `son/generer.mjs` écrit
trois carillons dans `assets/son/` (des cloches, c'est-à-dire une fondamentale
et des partiels qui s'éteignent plus vite qu'elle, plus une réverbération à
quatre échos). Il part à l'overlay par un canal à part de la voix (`son`) :
il ne doit ni entrer dans la file de lecture, ni être coupé avec elle.

## Mémoire d'Iris

Dans `%APPDATA%/iris/memoire/`, trois choses qui ne se relisent pas au même
moment — tout charger à chaque question ferait grossir la consigne sans fin :

| | |
|---|---|
| `memoire.md` | Le mémo : des faits courts et durables, donné en entier dans chaque consigne. Créé au premier lancement avec ce qu'on sait de la machine (Firefox, et le navigateur par défaut, qui chez Lucas est **Arc** : ouvrir un lien « normalement » lançait Arc, qui demande un profil). |
| `fiches/*.md` | Une fiche par sujet. Seul le **sommaire** entre dans la consigne : nom du fichier et première ligne de texte — d'où la consigne d'écrire une ligne de résumé en tête. Iris ouvre la fiche quand le sujet revient, et la complète après un travail. |
| `journal/AAAA-MM.md` | Ce qu'elle a fait, daté, un fichier par mois. C'est ce qui permet de répondre à « qu'est-ce que tu as fait hier ? ». |

Les deux dossiers sont créés par Iris au démarrage (`initialiserMemoire`), pas
par l'agent. Le tout est distinct de la mémoire de développement du dossier
`Apps`, qu'elle charge aussi.

## Comptes (Figma)

Un compte Figma = un serveur MCP (`claude mcp add --transport http <nom>
https://mcp.figma.com/mcp`), déclaré pour le dossier de travail d'Iris : c'est
ce qui garde les comptes cloisonnés. Le Claude Code d'Iris les voit tous.

La connexion, elle, coinçait : `claude mcp login` **refuse de finir sans vrai
terminal** (« stdin isn't a terminal »), et ouvre le navigateur par défaut
(Arc), où la session Figma n'est pas forcément la bonne.
`assets/outils/iris-connecter.cmd <serveur>` ouvre donc une petite fenêtre
PowerShell (`connexion.ps1`) qui lance `claude mcp login --no-browser`, repère
l'adresse dans la sortie et l'ouvre dans **Firefox en navigation privée** :
on s'y identifie avec le bon compte, sans toucher à la session ouverte.

- Depuis les **paramètres** (section « Comptes Figma », état lu par
  `claude mcp list`, qui sonde chaque serveur et prend quelques secondes).
- **À la voix** : le dossier `outils` est en tête du PATH de l'agent, et
  `--allowedTools "Bash(iris-connecter.cmd:*)"` l'autorise sans demande.
- `connexion.ps1` **doit garder son BOM UTF-8** : PowerShell 5.1 lit sinon le
  fichier en ANSI et casse les accents.
- Aucun nom de client dans le code (dépôt public) : Iris apprend quel serveur
  va avec quel client par la mémoire du dossier `Apps`.

## Quand elle demande une précision

L'agent peut s'arrêter en plein travail pour demander ce qui lui manque :
`iris-demander.cmd "ta question"` (ou `iris-demander` sur Mac) poste la
question au serveur local d'Iris, qui la **dit à voix haute**, ramène la barre
en face, écoute, et rend la phrase entendue sur la sortie standard. L'agent
reprend avec la réponse.

- Même plomberie que le garde : `garde.ts` sert désormais `/confirmer` **et**
  `/demander`, sur la boucle locale, avec le jeton du démarrage. Le serveur
  tourne toujours ; seul le hook du garde demande Node et le mode « Tout ».
- `question` dans `index.ts` est l'attente en cours : tant qu'elle est posée,
  une phrase dite n'ouvre pas un nouveau tour, elle est la réponse. Silence,
  raccourci ou tour abandonné rendent une réponse vide, et l'agent tranche
  lui-même — la consigne le lui dit.
- L'overlay affiche la question au centre (canal `confirmation`) pendant
  qu'elle la dit et pendant qu'elle écoute : c'est le seul moment où l'on
  répond à Iris, la perdre de vue c'est ne plus savoir quoi dire.
- **`charset=utf-8` sur la réponse du serveur** : sans lui, le client
  PowerShell lit en latin-1 et l'agent reçoit « franÃ§ais ». Et
  `[Console]::OutputEncoding` dans `demander.ps1`, pour la même raison en
  sortie.
- La consigne cadre l'usage : une seule question courte, seulement quand la
  réponse change ce qui va être fait.

## Autoriser l'accès complet

Iris démarre volontairement étroite : le dossier de travail, les dossiers
usuels, et l'écriture seule. Quand un outil lui est refusé, l'agent lance
`iris-autoriser.cmd "ce qu'il voulait faire"` : elle le dit à voix haute,
affiche **« J'autorise »** et **« Non »** dans la barre, et écoute. Sur un oui
— dit ou cliqué —, `accorderTout()` passe la permission à « Tout » et ouvre
`etendu` (tout le dossier de l'utilisateur, jamais Windows ni Program Files),
enregistre, et relance les Claude Code d'avance.

Le bouton existe parce qu'on n'a pas toujours envie de dire « oui » à voix
haute, et parce qu'une autorisation mérite un geste. Les actions irréversibles
restent soumises au garde, même une fois l'accès donné.

## Garde de l'irréversible — inachevé

`garde.ts` (serveur local à jeton) + `assets/garde.cjs` (hook `PreToolUse`) +
`demanderConfirmation()` dans `index.ts`. Actif seulement si Lucas choisit
lui-même « Tout » dans les paramètres. Le script seul est vérifié (il laisse
passer l'anodin et soumet suppressions, `git push`, écrasement hors projet),
mais **le parcours complet n'a jamais tourné** : la session de développement
a refusé de lancer Claude Code en mode sans autorisation pour le tester, puis
de poursuivre ce chantier. Il manque côté overlay : l'affichage de la question
(`surConfirmation` existe dans le preload, rien ne l'écoute) et le mode
d'écoute `confirmation` (il est traité comme une suite ; « oui » passe, « non »
et « c'est bon » sont lus comme un refus). Le libellé du mode « Tout » dans
`reglages.ts` dit encore « sans confirmation ».

## Journal

Chaque ligne part **aussi dans le terminal** (`[iris] …`) : le 21/09, le
fichier est resté muet pendant des lancements entiers sans qu'on trouve
pourquoi (Electron y écrit très bien en test), et le terminal est lisible
depuis la session. Écriture par ajout, élagage tous les 50 ajouts. Les erreurs
non rattrapées du main, la chute de l'overlay (`render-process-gone`, avec
rechargement) et ses `console.error` y remontent.

**Le journal n'a jamais été muet.** Pendant des jours, il semblait ne rien
recevoir : c'était une illusion de lecture. L'application Claude est installée
en paquet (MSIX), donc tout ce qu'elle et ses processus enfants lisent ou
écrivent dans `AppData\Roaming` passe par une copie privée
(`%LOCALAPPDATA%/Packages/Claude_*/LocalCache/Roaming/`). Une session de
développement lisait cette copie figée, pendant qu'Iris, lancée par Lucas,
écrivait dans le vrai dossier. Effacer la copie rend la vue réelle. À faire
avant de conclure quoi que ce soit sur un fichier de `%APPDATA%`.

`%APPDATA%/iris/journal.log`, 200 lignes : démarrage, veille prête ou non, ce
que la veille entend (énoncés définitifs), changements d'état, mot entendu,
questions, fin de lecture. **C'est la première chose à lire** quand Lucas dit
« elle ne répond plus » : l'enchaînement exact dit où la chaîne s'est arrêtée.

## Ce que le journal a appris (22/09/2026)

Premier vrai journal d'usage, et trois défauts qu'aucun essai n'avait montrés :

- **Elle partait en plein milieu.** Après une réponse, le micro se rouvrait
  pour six secondes, et le seuil sonore de l'overlay ne comptait pas toujours
  une voix posée : au bout du délai, il concluait que personne ne parlait et
  refermait, alors que la veille, elle, transcrivait la phrase. Les deux
  oreilles se parlent maintenant (`Veille.surEnonce` → l'écoute compte cet
  énoncé comme de la parole), et les délais passent à 11 et 13 secondes.
- **Tout partait sur Haiku.** « Tu peux installer l'app Logitech » n'était pas
  reconnu comme une action : les verbes des règles étaient écrits sans leurs
  terminaisons (`installe`, jamais `installer`). D'où des réponses expédiées,
  qui passaient pour « elle explique mal ». Les verbes acceptent leurs
  terminaisons, une famille « toucher à la machine » part sur Sonnet, et un
  sujet ne **redescend** plus de modèle en cours de route (`modeleCourant`).
- **Le micro choisi n'existait plus**, à chaque écoute, en silence. Il est
  maintenant oublié à la première absence (`micro-perdu`).

Reste ouvert : un `overlay tombé (crashed, code -1)` au repos, rechargé
automatiquement, sans cause trouvée.

## Les trois décisions qui tiennent tout

**Le cerveau est l'abonnement, pas une clé d'API.** `cerveau.ts` lance la CLI
`claude` déjà installée : les jetons sont ceux du forfait. Remplacer cet appel
par l'API Anthropic remettrait une facture à la consommation, qui est
exactement ce qui avait fait renoncer au projet.

**Aucun aiguillage d'intention.** L'agent arrive avec ses outils et choisit
lui-même. Le prédécesseur (Nova) détectait l'action par listes de mots-clés,
et chaque correction en cassait une autre : ne jamais réintroduire de
`detect_action`.

**La consigne impose une ou deux phrases** (`shared/conversation.ts`). C'est ce
qui rend l'assistant écoutable : un paragraphe prononcé est insupportable. La
réponse longue vit dans la fenêtre de conversation, pas dans la voix.

## Ce qu'il ne faut pas casser

- **`--output-format stream-json` exige `--verbose`**, sinon la CLI refuse de
  démarrer sans rien expliquer.
- **La question part par l'entrée standard**, jamais en argument : une phrase
  dictée contient des guillemets et des points d'exclamation que `cmd.exe`
  interprète.
- **On lance `claude.exe` directement, jamais `claude.cmd`.** Le `.cmd` impose
  `shell: true`, et `cmd.exe` ne met aucun argument entre guillemets : la
  consigne était découpée mot par mot et ses retours à la ligne terminaient la
  commande. L'interruption passe par `taskkill /t` pour tuer aussi les
  processus que l'agent a lancés.
- **Les dossiers usuels sont ajoutés en `--add-dir`** (Téléchargements, Bureau,
  Documents, Images, Musique, Vidéos, via `app.getPath`). Sans eux, « mets-le
  dans mes téléchargements » était refusé.
- **Un chemin n'est jamais prononcé.** La consigne l'interdit, et
  `parlerChemins()` dans `voix.ts` le rattrape quand même :
  `…\Downloads\page.html` devient « page.html dans tes Téléchargements ».
- **L'overlay ne prend jamais le focus** (`showInactive`, `focusable: false`) :
  on parle à Iris par-dessus un jeu. Il ne reçoit donc aucune touche, et tout
  passe par le `globalShortcut`.
- **L'overlay est la seule fenêtre qui joue du son** : il reste chargé en
  permanence, masqué, et les trois `appendSwitch` anti-throttling l'empêchent
  d'être gelé par Chromium.
- **Chaque écoute porte un numéro** (`ecouteRef`). Une transcription qui revient
  après une annulation appartient à un tour périmé et doit être ignorée.
- **Le texte de `result` fait foi** sur le texte final : les deltas peuvent
  manquer la fin, et c'est aussi `result` qui porte « Not logged in ».
- **Tailwind et PostCSS résolvent leurs chemins depuis le dossier d'où la
  commande est lancée.** `postcss.config.js` et `tailwind.config.js` sont
  ancrés sur `__dirname` : sans ça, une build lancée depuis le dossier parent
  sort sans aucun style, sans la moindre erreur.
- **Le tray veut deux PNG, pas un ICO.** Electron ramène un ICO à 256 px avant
  de le rendre. L'icône d'application, elle, reste un ICO multi-tailles.

## Réglages

`shared/reglages.ts` est **la** définition, partagée par les trois process, et
`normalizeReglages()` ramène les anciens fichiers à la forme courante. Le
fichier vit dans `%APPDATA%/iris/reglages.json`.

Au premier lancement, la clé Groq est reprise de `%APPDATA%/voice-type/settings.json`
si elle y est : même compte, même machine.

`permission` mappe sur `--permission-mode` : `lecture` → `default`,
`edition` → `acceptEdits`, `total` → `bypassPermissions`. En mode non
interactif, **personne ne peut répondre à une demande d'autorisation** : tout
ce qui en demanderait une est refusé. C'est pour ça que « créer une app » exige
`total`.

## Vérifier l'interface sans lancer Electron

`verif/vite.config.ts` (hors dépôt) sert `src/renderer` avec un `window.api`
bouchonné et un faux micro — un oscillateur relié à un
`createMediaStreamDestination()`, ce qui fait vivre l'anneau sans autorisation.

```bash
npx vite --config verif/vite.config.ts
```

`?page=overlay`, `&forme=pastille`, `&micro=0` (anneau sans spectre), puis
`window.iris.etat('reflexion')`, `.question()`, `.reponse()`, `.outil()`,
`.erreur()` dans la console. C'est le seul moyen de regarder l'overlay sans
voler le focus à ce qui tourne en plein écran.

## Images

`logo/iris.svg` est la source ; `node logo/generer.mjs` sort les six PNG du tray,
`icon.png`, `icon.ico` (sept tailles, écrites à la main) et `logo/iris-1024.png`
pour la vitrine. `sharp` est emprunté à `../luth/node_modules` : une
bibliothèque native de cette taille n'a rien à faire dans une application qui
ne redimensionne rien.

## Publier une version

Dépôt public `Luth-infinity/iris`, pour **Windows et macOS**. Numérotation en
`0.x`, ne jamais passer `1.0.0` (`electron-updater` ne redescend pas).

Le 22/09/2026, une `1.0.1` est partie par erreur : elle a été **masquée en
pré-version** (pas supprimée — les liens de ceux qui l'auraient prise restent
valides), le site et l'updater ignorent les pré-versions, et la `0.3.0` a été
publiée à sa place. Un poste déjà passé en 1.0.1 ne redescend pas tout seul :
il faut réinstaller. C'est la seule façon de revenir en arrière.

Les binaires ne se construisent pas ici : `.github/workflows/release.yml`
(repris de VoiceType) construit l'installeur Windows et les deux `.dmg` (Intel
et Apple Silicon) à chaque tag `vX.Y.Z`, les joint à une release brouillon,
puis la publie une fois les deux jobs réussis. Le `.dmg` ne se fabrique que
sur macOS, d'où le runner.

1. Bump `package.json`, commit, push.
2. `gh release create vX.Y.Z --draft --title vX.Y.Z --notes-file …` : les
   notes d'abord, en brouillon. Français, puis `## English` et sa traduction ;
   le site en garde quatre lignes par version (> 25 caractères, pas de `#`,
   `**`, `>` en tête).
3. `git tag vX.Y.Z` puis `git push origin vX.Y.Z` : le workflow complète le
   brouillon et le publie. Suivre avec `gh run watch`.

`src/main/updates.ts` : sous Windows, `electron-updater` télécharge et
installe sur place (il faut le `latest.yml` que le workflow joint). Sous
macOS, l'installation sur place exige une app signée et notariée : Iris lit
la dernière release et ouvre sa page. Vérification 20 s après le démarrage
puis toutes les deux heures, tout passe par le menu de l'icône, et rien ne
s'installe sans clic. Installer pose `quitte = true`, sinon les fenêtres qui
se cachent au lieu de se fermer retiennent la sortie.

## macOS

Écrit et construit par le runner, **jamais lancé sur un vrai Mac** au
21/09/2026. Ce qui a été adapté :

- **PATH** : une app ouverte depuis le Finder n'a que `/usr/bin:/bin…`. Celui
  du shell de connexion est repris au démarrage (`index.ts`), avec
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`.
- **Claude Code** : emplacements connus d'abord (`commandeClaude`), puis
  `claude` dans le PATH.
- **Arrêt** : l'agent est lancé en tête de son groupe de processus
  (`detached`), et `tuer` signale le groupe entier, l'équivalent de
  `taskkill /t`.
- **Connexion des comptes** : `assets/outils/iris-connecter` +
  `connexion.sh`, qui ouvrent une fenêtre du Terminal par `osascript`, puis
  Firefox en navigation privée. Ces deux fichiers doivent rester en LF
  (`.gitattributes`) et exécutables (`git update-index --chmod=+x`).
- **Fenêtres** : l'overlay suit sur les bureaux plein écran
  (`setVisibleOnAllWorkspaces`) ; historique et paramètres gardent un cadre
  classique, sans quoi les pastilles de fermeture disparaissent.
- `LSUIElement` : pas d'icône dans le Dock, Iris vit dans la barre des menus.
- L'app n'est pas signée : première ouverture par clic droit, puis Ouvrir.

## Le guide de démarrage

`pages/Bienvenue.tsx`, une quatrième fenêtre, ouverte au premier lancement à la
place de l'annonce et par le menu de l'icône. Cinq étapes : prénom, Claude Code,
clé de transcription, voix et micro, puis ce qu'on peut lui dire.

Le principe : **rien n'est cru sur parole**. `etatClaude()` lance
`claude --version` puis `claude auth status` et affiche ce qu'il manque ;
`preparerClaude()` ouvre un terminal (`assets/outils/claude-setup*`) qui
installe Claude Code avec la commande officielle d'Anthropic, puis enchaîne sur
`claude auth login` — les deux exigent un vrai terminal, comme la connexion des
comptes. La clé est essayée sur la liste des modèles du fournisseur (la requête
la moins chère qui prouve la même chose qu'une transcription), la voix est
jouée, le micro fait bouger une barre.

Le raccourci global est enregistré **avant** d'ouvrir le guide : il peut être
refermé en cours de route, et Iris doit répondre quand même. La dernière étape
n'installe rien, elle apprend quoi dire : c'est la question que tout le monde
pose devant un micro.

## Le prénom

La consigne, la mémoire de départ et la voix d'essai disaient « Lucas » en
dur. C'est devenu le réglage `prenom` (réglages version 4) : les fichiers
antérieurs, qui ne peuvent être que les siens, reçoivent « Lucas » ; une
nouvelle installation part vide, et Iris ne nomme alors personne.

## Le site

`site/` : Next.js 15 + Tailwind 4, `iris-luth.vercel.app`. Même mécanique que
VoiceType (bascule FR/EN, `Reveal`, `releases.ts` qui lit les releases : le
lien de téléchargement et le journal se mettent à jour seuls), mais sa propre
identité : page blanche comme un bureau, ce qui appartient à Iris posé en
sombre (la barre et la pastille rejouées en HTML, l'anneau animé en CSS), police
Instrument Sans, **noir et blanc, aucune couleur hors de l'icône**. Déploiement
`vercel --prod` depuis `site/`, puis vérifier l'alias en ligne.
