@echo off
setlocal
cd /d "%~dp0"
title Beach Boulevard Runner v2.5.24 - local server (MIME fix)
set PORT=8766
where py >nul 2>nul
if errorlevel 1 goto NOPY
echo.
echo   Beach Boulevard Runner v2.5.24 (MIME fix server)
echo   Same as start-game.cmd, but forces the correct JavaScript MIME type.
echo   Use it if Windows maps .js files to text/plain and the game does not start.
echo   Serving at http://127.0.0.1:%PORT%/index.html - close this window to stop.
echo.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%/index.html"
py -3 -c "import http.server as h; H=h.SimpleHTTPRequestHandler; H.extensions_map.update({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.mp3':'audio/mpeg'}); h.test(HandlerClass=H, port=8766, bind='127.0.0.1')"
goto END
:NOPY
echo.
echo   The Python launcher "py" was not found.
echo   Install Python 3 from https://www.python.org/downloads/ and run this file again.
echo.
pause
:END
endlocal
