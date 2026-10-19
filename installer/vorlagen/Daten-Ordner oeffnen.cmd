@echo off
rem Oeffnet den Ordner mit Quizzen, Ergebnissen, Medien und config.json (Admin-PIN, Port).
if not exist "%LOCALAPPDATA%\QuizMasterFW" mkdir "%LOCALAPPDATA%\QuizMasterFW"
start "" explorer "%LOCALAPPDATA%\QuizMasterFW"
