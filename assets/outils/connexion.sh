#!/bin/sh
# Connecte un serveur MCP (un compte Figma, surtout) au Claude Code d'Iris.
#
# `claude mcp login` refuse de finir sans vrai terminal, et ouvre le navigateur
# par défaut, où la session Figma n'est pas forcément la bonne. Ici : une
# fenêtre du Terminal, et la page d'autorisation dans une fenêtre privée de
# Firefox, sans aucune session ouverte. On s'y connecte avec le compte voulu.
serveur="$1"
printf '\n  Connexion de %s\n' "$serveur"
printf '  Connecte-toi avec le bon compte dans la fenêtre privée, puis autorise.\n\n'

ouverte=""
# La sortie passe par le tube pour y repérer l'adresse ; l'entrée reste le
# terminal, ce que la commande exige.
claude mcp login "$serveur" --no-browser 2>&1 | while IFS= read -r ligne; do
  adresse="$(printf '%s' "$ligne" | grep -oE 'https://[^ ]*oauth[^ ]*')"
  if [ -z "$ouverte" ] && [ -n "$adresse" ]; then
    ouverte=1
    if [ -d /Applications/Firefox.app ]; then
      open -na Firefox --args -private-window "$adresse"
      echo "  Page ouverte dans Firefox (fenêtre privée)."
    else
      open "$adresse"
      echo "  Firefox introuvable : page ouverte dans le navigateur par défaut."
    fi
  else
    case "$ligne" in
      *uccess*|*onnected*|*uthenticated*|*"Couldn't"*|*rror*|*ailed*|*edirect*) echo "  $ligne" ;;
    esac
  fi
done

printf '\n  Terminé. Tu peux fermer cette fenêtre.\n'
