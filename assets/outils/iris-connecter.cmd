@echo off
rem Ouvre la connexion d un serveur MCP dans sa propre fenetre et rend la main tout de suite.
rem Le dossier courant compte : les serveurs Figma sont declares pour le dossier Apps.
if "%~1"=="" (echo Usage : iris-connecter.cmd nom-du-serveur& exit /b 1)
start "Iris - connexion %~1" /D "%CD%" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0connexion.ps1" -Serveur "%~1"
echo Fenetre de connexion ouverte pour %~1.
