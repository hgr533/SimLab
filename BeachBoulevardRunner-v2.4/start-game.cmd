@echo off
setlocal
cd /d "%~dp0"
title Beach Boulevard Runner v2.4 - local server
set PORT=8765
where py >nul 2>nul
if errorlevel 1 goto NOPY
echo.
echo   Beach Boulevard Runner v2.4
echo   Serving this folder at http://127.0.0.1:%PORT%/index.html
echo   Keep this window open while you play. Close it to stop the server.
echo   If the page stays on "The game did not start", use start-game-mimefix.cmd
echo.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%/index.html"
py -3 -m http.server %PORT% --bind 127.0.0.1
goto END
:NOPY
echo.
echo   The Python launcher "py" was not found.
echo   Install Python 3 from https://www.python.org/downloads/ and run this file again.
echo.
pause
:END
endlocal
