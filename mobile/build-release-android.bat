@echo off
setlocal

set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\build-install-android.ps1" -Variant release -PrebuildClean %*

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Release build or install failed. Check logs above.
  exit /b %ERRORLEVEL%
)

echo.
echo Release build and install completed.
exit /b 0

