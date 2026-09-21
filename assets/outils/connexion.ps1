# Connecte un serveur MCP (un compte Figma, surtout) au Claude Code d'Iris.
#
# `claude mcp login` refuse de finir sans vrai terminal, et ouvre le navigateur
# par défaut (Arc, chez Lucas), où la session Figma n'est pas forcément la
# bonne. Ici : une petite fenêtre de terminal, et la page d'autorisation dans
# une fenêtre privée de Firefox, sans aucune session ouverte. On s'y connecte
# avec le compte voulu : c'est ce qui garde les comptes cloisonnés.
param([Parameter(Mandatory = $true)][string]$Serveur)

$Host.UI.RawUI.WindowTitle = "Iris · connexion $Serveur"
try { $Host.UI.RawUI.WindowSize = New-Object Management.Automation.Host.Size(96, 16) } catch {}

$firefox = @(
  "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
  "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
  "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host ""
Write-Host "  Connexion de $Serveur" -ForegroundColor Magenta
Write-Host "  Connecte-toi avec le bon compte dans la fenêtre privée de Firefox, puis autorise." -ForegroundColor DarkGray
Write-Host ""

$ouverte = $false
# La sortie passe par le pipeline pour y repérer l'adresse ; l'entrée reste le
# terminal, ce que la commande exige.
& claude mcp login $Serveur --no-browser 2>&1 | ForEach-Object {
  $ligne = "$_"
  if (-not $ouverte -and $ligne -match '(https://\S+oauth\S+)') {
    $ouverte = $true
    if ($firefox) {
      Start-Process $firefox -ArgumentList '-private-window', $Matches[1]
      Write-Host "  Page ouverte dans Firefox (fenêtre privée)." -ForegroundColor DarkGray
    } else {
      Start-Process $Matches[1]
      Write-Host "  Firefox introuvable : page ouverte dans le navigateur par défaut." -ForegroundColor Yellow
    }
  } elseif ($ligne -match 'redirect URL|Paste') {
    Write-Host "  $ligne"
  } elseif ($ligne -match 'uccess|onnected|uthenticated') {
    Write-Host "  $ligne" -ForegroundColor Green
  } elseif ($ligne -match "Couldn't|rror|ailed") {
    Write-Host "  $ligne" -ForegroundColor Red
  }
}

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "  C'est fait. Iris s'en servira dès sa prochaine demande." -ForegroundColor Green
  Start-Sleep -Seconds 3
} else {
  Write-Host ""
  Read-Host "  La connexion n'a pas abouti. Entrée pour fermer"
}
