@echo off
rem Installe Claude Code, ou l'y connecte, dans sa propre fenetre.
rem Les deux reclament un vrai terminal : l'installation affiche sa progression,
rem la connexion attend le retour du navigateur.
if "%~1"=="installer" goto ok
if "%~1"=="connexion" goto ok
echo Usage : claude-setup.cmd installer^|connexion
exit /b 1
:ok
start "Iris - Claude Code" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0claude-setup.ps1" -Quoi "%~1"
echo Fenetre ouverte (%~1).
