@echo off
rem Demande l acces complet, en une phrase parlee.
if "%~1"=="" (echo Usage : iris-autoriser.cmd "ce que tu veux faire"& exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0demander.ps1" -Route autoriser %*
