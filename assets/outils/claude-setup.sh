#!/bin/sh
# Ce qui tourne dans la fenêtre du Terminal ouverte par `claude-setup`.
quoi="$1"

if [ "$quoi" = "installer" ]; then
  printf '\n  Installation de Claude Code\n'
  printf '  Commande officielle : curl -fsSL https://claude.ai/install.sh | bash\n\n'
  if ! curl -fsSL https://claude.ai/install.sh | bash; then
    printf '\n  L’installation a échoué.\n'
    read -r _ <&1
    exit 1
  fi
  printf '\n  Installé. On enchaîne sur la connexion.\n'
fi

printf '\n  Connexion de Claude Code\n'
printf '  Une page va s’ouvrir dans ton navigateur : connecte-toi, puis reviens ici.\n\n'

# Le PATH de cette fenêtre date d'avant l'installation.
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

if ! claude auth login; then
  printf '\n  Si la commande est introuvable, ferme et rouvre cette fenêtre, puis tape : claude\n'
  read -r _ <&1
  exit 1
fi

printf '\n  C’est bon. Retourne dans Iris et clique sur Revérifier.\n'
sleep 4
