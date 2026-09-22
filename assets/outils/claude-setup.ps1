# Installe Claude Code, ou connecte celui qui est déjà là.
#
# Iris ne peut pas faire ça en silence : l'installateur officiel affiche sa
# progression, et la connexion ouvre le navigateur puis attend la réponse. Les
# deux commandes sont celles de la documentation d'Anthropic, rien de plus.
param([ValidateSet('installer', 'connexion')][string]$Quoi = 'installer')

$Host.UI.RawUI.WindowTitle = 'Iris · Claude Code'

if ($Quoi -eq 'installer') {
  Write-Host ''
  Write-Host '  Installation de Claude Code' -ForegroundColor Magenta
  Write-Host '  Commande officielle : irm https://claude.ai/install.ps1 | iex' -ForegroundColor DarkGray
  Write-Host ''
  try {
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  } catch {
    Write-Host "  L'installation a échoué : $_" -ForegroundColor Red
    Read-Host '  Entrée pour fermer'
    exit 1
  }
  Write-Host ''
  Write-Host '  Installé. On enchaîne sur la connexion.' -ForegroundColor Green
  Write-Host ''
}

Write-Host ''
Write-Host '  Connexion de Claude Code' -ForegroundColor Magenta
Write-Host '  Une page va s’ouvrir dans ton navigateur : connecte-toi, puis reviens ici.' -ForegroundColor DarkGray
Write-Host ''

# Le PATH de cette fenêtre date d'avant l'installation : on ajoute les
# emplacements posés par l'installateur, sinon `claude` reste introuvable.
$env:PATH = "$env:USERPROFILE\.local\bin;$env:APPDATA\npm;$env:PATH"

& claude auth login
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '  Si la commande est introuvable, ferme et rouvre cette fenêtre, puis tape : claude' -ForegroundColor Yellow
  Read-Host '  Entrée pour fermer'
  exit 1
}

Write-Host ''
Write-Host '  C’est bon. Retourne dans Iris et clique sur Revérifier.' -ForegroundColor Green
Start-Sleep -Seconds 4
