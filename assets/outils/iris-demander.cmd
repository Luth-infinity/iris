@echo off
rem Pose une question a voix haute et rend la reponse sur la sortie standard.
if "%~1"=="" (echo Usage : iris-demander.cmd "ta question"& exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demander.ps1" %*
