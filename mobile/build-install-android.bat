@echo off
setlocal

set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\build-install-android.ps1" %*

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Build or install failed. Check logs above.
  exit /b %ERRORLEVEL%
)

echo.
echo Build and install completed.
exit /b 0
