@echo off
rem Startet QuizMaster FW (installierte Version) und oeffnet die Verwaltung im Browser.
rem Daten und config.json liegen je Benutzer unter %LOCALAPPDATA%\QuizMasterFW
chcp 65001 >nul
title QuizMaster FW
set "QMFW_DATA_DIR=%LOCALAPPDATA%\QuizMasterFW"
set "QMFW_CONFIG=%LOCALAPPDATA%\QuizMasterFW\config.json"
set "QMFW_BROWSER=1"
"%~dp0node\node.exe" "%~dp0app\server\index.js"
echo.
echo QuizMaster FW wurde beendet.
pause
