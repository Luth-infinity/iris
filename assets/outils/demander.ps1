# Pose une question à voix haute et rend la réponse, pour l'agent.
#
# L'agent s'arrête au milieu de son travail, Iris dit la question, écoute, et
# la réponse revient sur la sortie standard. Le serveur est celui d'Iris, sur
# la boucle locale, avec le jeton tiré au démarrage : sans ces deux variables,
# personne d'autre ne peut faire parler Iris.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Mots)

# La réponse contient des accents : sans ça, la sortie passe par la page de
# code de la console et l'agent reçoit du charabia.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$question = ($Mots -join ' ').Trim('"', ' ')
if (-not $question) { exit 1 }

$port = $env:IRIS_GARDE_PORT
$jeton = $env:IRIS_GARDE_JETON
if (-not $port -or -not $jeton) {
  # Iris n'écoute pas : l'agent continue sans la précision plutôt que d'attendre.
  exit 0
}

try {
  $corps = @{ question = $question } | ConvertTo-Json -Compress
  $reponse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/demander" `
    -Headers @{ 'x-iris-jeton' = $jeton } -ContentType 'application/json' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($corps)) -TimeoutSec 120
  if ($reponse.reponse) { Write-Output $reponse.reponse }
} catch {
  # Pas de réponse : l'agent reçoit une sortie vide, et tranche lui-même.
}
