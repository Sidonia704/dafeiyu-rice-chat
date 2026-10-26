@echo off
chcp 65001 >nul
cd /d "%~dp0"
node --env-file-if-exists=.env server/index.mjs
pause
