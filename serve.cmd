@echo off
setlocal
cd /d "%~dp0"
REM Only the Python fallback uses this. The Node server picks its own port:
REM PORT in .env, else 8123.
set "PORT=8123"

REM The app is built from ES modules, which browsers refuse to load over
REM file:// - so it has to be served over http.
where node   >nul 2>&1 && goto :usenode
where python >nul 2>&1 && goto :usepython
where py     >nul 2>&1 && goto :usepy
goto :nohost

:usenode
node tools\serve.mjs
goto :end

:usepython
echo Better Playlist Player -^> http://localhost:%PORT%/index.html
echo Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/index.html"
python -m http.server %PORT%
goto :end

:usepy
echo Better Playlist Player -^> http://localhost:%PORT%/index.html
echo Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/index.html"
py -m http.server %PORT%
goto :end

:nohost
echo Neither Node nor Python was found on PATH.
echo.
echo This app needs a local web server - opening index.html directly will not
echo work, because browsers block JavaScript modules on file:// URLs.
echo Install Node from https://nodejs.org and run this again.

:end
echo.
pause
