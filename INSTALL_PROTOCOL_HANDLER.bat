@echo off
REM Automated installation script for Explorer Protocol Handler
REM Run as Administrator

echo ========================================
echo   Explorer Protocol Handler Installer
echo ========================================
echo.

REM Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo.
    echo Right-click this file and select "Run as Administrator"
    echo.
    pause
    exit /b 1
)

echo Step 1: Copying PowerShell script to C:\Windows\...
copy /Y "%~dp0open-folder-handler.ps1" "C:\Windows\open-folder-handler.ps1" >nul
if %errorLevel% neq 0 (
    echo ERROR: Failed to copy PowerShell script!
    pause
    exit /b 1
)
echo [OK] PowerShell script copied successfully

echo.
echo Step 2: Registering protocol handler in registry...
reg import "%~dp0register-explorer-protocol.reg" >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Failed to register protocol handler!
    pause
    exit /b 1
)
echo [OK] Protocol handler registered successfully

echo.
echo Step 3: Testing installation...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path 'C:\Windows\open-folder-handler.ps1') { exit 0 } else { exit 1 }" >nul
if %errorLevel% neq 0 (
    echo ERROR: PowerShell script not found!
    pause
    exit /b 1
)
echo [OK] PowerShell script exists

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo The explorer: protocol is now registered.
echo You can now use explorer:// links to open folders.
echo.
echo Test it in your browser console:
echo   window.location.href = 'explorer:C:\\Windows';
echo.
echo To uninstall, run: unregister-explorer-protocol.reg
echo.
pause
