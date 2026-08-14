@echo off
setlocal

title Project Browser

REM ---------------------------------------------------------------
REM  Double-click this to start Project Browser.
REM
REM  %~dp0 is the folder this .bat lives in, with a trailing slash.
REM  Using it means the launcher works no matter where you put the
REM  folder, and no matter which directory Explorer happens to be in
REM  when you double-click.
REM ---------------------------------------------------------------

cd /d "%~dp0"

echo.
echo   PROJECT BROWSER
echo   ---------------
echo.

REM --- Is Node installed? ---------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js isn't installed, or Windows can't find it.
    echo.
    echo   Install the LTS version from https://nodejs.org
    echo   then close this window, open a NEW one, and try again.
    echo.
    pause
    exit /b 1
)

REM --- First run? Fetch dependencies ----------------------------
REM  "call" matters here. npm is itself a batch file, so running it
REM  without call hands over control and never comes back - the rest
REM  of this script would silently never run.
if not exist "node_modules\" (
    echo   First run - downloading Electron. This takes a few minutes
    echo   and only happens once.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo   Install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM --- Go ---------------------------------------------------------
echo   Starting. Keep this window open while you use the app -
echo   closing it quits Project Browser.
echo.
echo   New bounces get logged here as they're detected.
echo.

call npm start

REM --- Only reached if the app exits ------------------------------
REM  If it crashed, the error is above and would vanish with the
REM  window. Pausing keeps it readable.
if errorlevel 1 (
    echo.
    echo   Project Browser stopped unexpectedly. The error is above.
    echo.
    pause
)

endlocal
