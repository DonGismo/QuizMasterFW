@echo off
cd /d "%~dp0"
title QuizMaster FW
if not exist node_modules (
  echo Installiere Abhaengigkeiten...
  call npm install
)
node server\index.js
pause
