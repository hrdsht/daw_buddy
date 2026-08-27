@echo off
setlocal EnableDelayedExpansion
title DAW Buddy

:: Move to the directory where this script is located
cd /d "%~dp0"

echo ===================================================
echo   Starting DAW Buddy...
echo ===================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 goto NoNode

:: Run the launcher directly with Node
node scripts/launch.js
if %ERRORLEVEL% neq 0 goto AppError

goto End

:NoNode
echo [ERROR] Node.js was not found in your PATH.
echo Please install Node.js from https://nodejs.org/
echo.
pause
exit /b 1

:AppError
echo.
echo [ERROR] DAW Buddy exited with error code: %ERRORLEVEL%
pause
exit /b %ERRORLEVEL%

:End
pause
