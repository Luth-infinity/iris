# Iris

Une assistante vocale de bureau, pour Windows. On dit « Iris » (ou
Ctrl + Maj + Espace), on parle, elle répond à voix haute, et elle agit vraiment
sur la machine : lire des fichiers, en écrire, lancer des commandes, monter un
projet.

Site : [iris-luth.vercel.app](https://iris-luth.vercel.app) · Téléchargement :
[releases](https://github.com/Luth-infinity/iris/releases)

## Ce qui la rend possible

| | |
|---|---|
| **Le cerveau** | Le Claude Code déjà installé, appelé en mode non interactif. Ce sont les jetons de l'abonnement, pas une facturation à l'appel. |
| **Les oreilles** | Whisper chez Groq (compte gratuit), et un modèle Vosk hors ligne pour le mot d'appel. |
| **La voix** | La lecture à voix haute de Microsoft Edge : gratuite, sans clé. |

## Avant de l'installer

- Claude Code installé et connecté : `claude auth login` une fois dans un terminal.
- Une clé Groq, à coller dans les paramètres (reprise de VoiceType si elle y est).

## À l'écran

- **La barre**, en bas de l'écran : l'anneau qui suit la voix et une phrase.
  Elle ne prend jamais le focus.
- **La pastille**, au bord droit, quand le travail dure, avec sa liste de
  tâches en bulles.
- **Le menu de l'icône** : historique, paramètres, mises à jour.

## Développer

```bash
npm install
npm run dev
```

`CLAUDE.md` rassemble les partis pris et les pièges. Le site vit dans `site/`.
