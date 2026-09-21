/**
 * Les textes du site, dans les deux langues.
 *
 * Tout ce qui se lit est ici : la vitrine ne contient pas une phrase en dur,
 * sans quoi la version anglaise finit par prendre du retard sur la française
 * sans que personne ne s'en aperçoive.
 */

export type Langue = 'fr' | 'en';

export type Contenu = {
  meta: { title: string; description: string };
  nav: { echange: string; versions: string; telecharger: string; langue: string };
  hero: { titre: [string, string]; texte: string; mention: string };
  barre: { phrase: string; aide: string };
  echange: {
    titre: string;
    temps: { titre: string; texte: string }[];
    taches: { libelle: string; etat: 'fait' | 'cours' | 'attente' }[];
  };
  couts: { titre: string; items: { role: string; titre: string; texte: string }[] };
  details: { titre: string; texte: string }[];
  telecharger: {
    windows: string;
    toutes: string;
    version: string;
    titre: string;
    prerequis: { titre: string; texte: string }[];
    cle: string;
  };
  changelog: { titre: string };
  pied: { suite: string; code: string; versions: string };
};

export const fr: Contenu = {
  meta: {
    title: 'Iris — une assistante vocale qui agit sur votre PC',
    description:
      'Dites « Iris », demandez. Elle lit, écrit, lance et construit sur votre machine, puis vous répond à voix haute. Pour Windows, avec votre abonnement Claude.'
  },
  nav: {
    echange: 'Comment ça se passe',
    versions: 'Versions',
    telecharger: 'Télécharger',
    langue: 'Langue'
  },
  hero: {
    titre: ['Dites « Iris ».', 'Elle s’en occupe.'],
    texte:
      'Une assistante vocale pour Windows qui agit vraiment sur votre machine : elle lit vos fichiers, en écrit, lance des commandes, monte un projet. Vous parlez, elle répond à voix haute, en une ou deux phrases.',
    mention: 'Windows · gratuit · s’appuie sur Claude Code'
  },
  barre: {
    phrase: 'Je t’écoute.',
    aide: 'une pause et j’envoie'
  },
  echange: {
    titre: 'Une conversation, pas une fenêtre de plus.',
    temps: [
      {
        titre: 'Vous l’appelez',
        texte:
          'Son nom, le raccourci Ctrl+Maj+Espace ou un clic sur l’icône. Elle apparaît en bas de l’écran sans voler le focus, par-dessus un jeu en plein écran s’il le faut.'
      },
      {
        titre: 'Elle travaille sur le côté',
        texte:
          'Si la tâche dure, elle se range au bord de l’écran. Sa liste de tâches s’y affiche en bulles, comme dans Claude Code : vous voyez où elle en est sans qu’elle vous gêne.'
      },
      {
        titre: 'Elle répond, puis vous écoute',
        texte:
          'La réponse est dite à voix haute pendant qu’elle s’écrit. Ensuite le micro reste ouvert quelques secondes : on enchaîne sans redire son nom, ou on se tait et elle s’efface.'
      }
    ],
    taches: [
      { libelle: 'Lecture du projet', etat: 'fait' },
      { libelle: 'Ajout du formulaire', etat: 'cours' },
      { libelle: 'Vérification', etat: 'attente' }
    ]
  },
  couts: {
    titre: 'Sans facture à l’usage.',
    items: [
      {
        role: 'Le cerveau',
        titre: 'Claude Code',
        texte:
          'Celui déjà installé sur votre machine, en mode non interactif. Ce sont les jetons de votre abonnement Claude, pas une clé d’API facturée à l’appel.'
      },
      {
        role: 'Les oreilles',
        titre: 'Whisper chez Groq',
        texte:
          'La transcription de votre voix. Le compte est gratuit, et un usage quotidien tient dans l’offre sans frais.'
      },
      {
        role: 'La voix',
        titre: 'Les voix d’Edge',
        texte:
          'La lecture à voix haute de Microsoft Edge, gratuite et sans clé. Les timbres multilingues disent « GitHub » ou « Figma » correctement au milieu d’une phrase.'
      }
    ]
  },
  details: [
    {
      titre: 'Son nom reste chez vous',
      texte:
        'Le mot d’appel est reconnu par un modèle hors ligne. Rien ne quitte la machine tant que vous ne l’avez pas appelée.'
    },
    {
      titre: 'Finir sans clavier',
      texte:
        'Deux secondes de silence envoient la demande. « C’est bon » l’envoie tout de suite, « laisse tomber » l’annule, et son nom la coupe quand elle parle.'
    },
    {
      titre: 'Le bon modèle, tout seul',
      texte:
        'Une question simple part sur Haiku, un outil à écrire sur Sonnet, un chantier sur Opus. Dites « prends Opus » pour trancher vous-même.'
    },
    {
      titre: 'Elle retient',
      texte:
        'Une mémoire à elle, qu’elle complète quand elle apprend comment ouvrir une application ou ce que vous préférez. Un simple fichier texte, que vous pouvez relire.'
    },
    {
      titre: 'Vos comptes, séparés',
      texte:
        'Un serveur par compte Figma. Pour en connecter un, elle ouvre une fenêtre privée de Firefox : on s’y identifie avec le bon compte, sans toucher à la session ouverte.'
    },
    {
      titre: 'Elle voit ce que vous lui montrez',
      texte:
        'Un dossier de travail, vos dossiers usuels, rien au-dessus. Trois niveaux d’autorisation, de la lecture seule aux commandes.'
    }
  ],
  telecharger: {
    windows: 'Télécharger pour Windows',
    toutes: 'Toutes les versions',
    version: 'Version',
    titre: 'Avant de l’installer',
    prerequis: [
      {
        titre: 'Claude Code, connecté',
        texte: 'Installé sur la machine, puis « claude auth login » une fois dans un terminal.'
      },
      {
        titre: 'Une clé Groq',
        texte: 'Gratuite, à coller dans les paramètres d’Iris. Déjà là si vous utilisez VoiceType.'
      },
      {
        titre: 'Windows 10 ou 11',
        texte: 'Elle parle français, et se met à jour toute seule depuis le menu de son icône.'
      }
    ],
    cle: 'Créer une clé Groq'
  },
  changelog: { titre: 'Ce qui a changé.' },
  pied: { suite: 'Les autres apps', code: 'Code source', versions: 'Versions' }
};

export const en: Contenu = {
  meta: {
    title: 'Iris — a voice assistant that acts on your PC',
    description:
      'Say “Iris” and ask. She reads, writes, runs and builds on your machine, then answers out loud. For Windows, on your Claude subscription.'
  },
  nav: {
    echange: 'How it goes',
    versions: 'Releases',
    telecharger: 'Download',
    langue: 'Language'
  },
  hero: {
    titre: ['Say “Iris”.', 'She’ll handle it.'],
    texte:
      'A voice assistant for Windows that actually acts on your machine: she reads your files, writes new ones, runs commands, sets up a project. You talk, she answers out loud, in a sentence or two.',
    mention: 'Windows · free · built on Claude Code'
  },
  barre: {
    phrase: 'Je t’écoute.',
    aide: 'une pause et j’envoie'
  },
  echange: {
    titre: 'A conversation, not another window.',
    temps: [
      {
        titre: 'You call her',
        texte:
          'Her name, Ctrl+Shift+Space, or a click on the tray icon. She shows up at the bottom of the screen without stealing focus, even over a full-screen game.'
      },
      {
        titre: 'She works on the side',
        texte:
          'When a task takes a while, she moves to the edge of the screen. Her task list shows up there as bubbles, just like in Claude Code: you see where she is without her getting in the way.'
      },
      {
        titre: 'She answers, then listens',
        texte:
          'The answer is spoken while it is being written. Then the mic stays open for a few seconds: carry on without saying her name again, or stay quiet and she fades away.'
      }
    ],
    taches: [
      { libelle: 'Lecture du projet', etat: 'fait' },
      { libelle: 'Ajout du formulaire', etat: 'cours' },
      { libelle: 'Vérification', etat: 'attente' }
    ]
  },
  couts: {
    titre: 'No pay-per-use bill.',
    items: [
      {
        role: 'The brain',
        titre: 'Claude Code',
        texte:
          'The one already installed on your machine, run non-interactively. It spends your Claude subscription, not an API key billed per call.'
      },
      {
        role: 'The ears',
        titre: 'Whisper on Groq',
        texte:
          'Transcribes your voice. The account is free, and daily use fits in the free tier.'
      },
      {
        role: 'The voice',
        titre: 'Edge voices',
        texte:
          'Microsoft Edge’s read-aloud voices, free and keyless. The multilingual ones say “GitHub” or “Figma” properly in the middle of a French sentence.'
      }
    ]
  },
  details: [
    {
      titre: 'Her name stays on your PC',
      texte:
        'The wake word is recognised by an offline model. Nothing leaves the machine until you call her.'
    },
    {
      titre: 'Done without a keyboard',
      texte:
        'Two seconds of silence send the request. “C’est bon” sends it right away, “laisse tomber” cancels, and her name cuts her off while she talks.'
    },
    {
      titre: 'The right model, on its own',
      texte:
        'A quick question goes to Haiku, a tool to write to Sonnet, a big job to Opus. Say “prends Opus” to decide yourself.'
    },
    {
      titre: 'She remembers',
      texte:
        'A memory of her own, which she fills in when she learns how to open an app or what you prefer. A plain text file you can read.'
    },
    {
      titre: 'Your accounts, kept apart',
      texte:
        'One server per Figma account. To connect one, she opens a private Firefox window: sign in with the right account, and your open session stays untouched.'
    },
    {
      titre: 'She sees what you show her',
      texte:
        'One working folder, your usual folders, nothing above. Three permission levels, from read-only to running commands.'
    }
  ],
  telecharger: {
    windows: 'Download for Windows',
    toutes: 'All releases',
    version: 'Version',
    titre: 'Before you install',
    prerequis: [
      {
        titre: 'Claude Code, signed in',
        texte: 'Installed on the machine, then “claude auth login” once in a terminal.'
      },
      {
        titre: 'A Groq key',
        texte: 'Free, pasted into Iris’s settings. Already there if you use VoiceType.'
      },
      {
        titre: 'Windows 10 or 11',
        texte: 'She speaks French, and updates herself from her tray icon menu.'
      }
    ],
    cle: 'Get a Groq key'
  },
  changelog: { titre: 'What changed.' },
  pied: { suite: 'More apps', code: 'Source code', versions: 'Releases' }
};
