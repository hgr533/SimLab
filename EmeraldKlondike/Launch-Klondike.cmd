@echo off
setlocal
set "game=%~dp0dist\index.html"
if not exist "%game%" set "game=%~dp0index.html"
if not exist "%game%" (
  echo Emerald Klondike could not find index.html. Extract the complete game folder first.
  pause
  exit /b 1
)
start "" "%game%"
endlocal
