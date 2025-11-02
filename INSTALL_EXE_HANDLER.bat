@echo off
:: Automated installation script for Explorer Protocol Handler (EXE version)
:: Run this as Administrator

echo ====================================
echo Explorer Protocol Handler Installer
echo ====================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script requires Administrator privileges.
    echo Right-click and select "Run as Administrator"
    pause
    exit /b 1
)

echo [1/3] Compiling C# handler...
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -File "%~dp0compile-handler.ps1"

if not exist "%~dp0ExplorerProtocolHandler.exe" (
    echo.
    echo ERROR: Compilation failed. ExplorerProtocolHandler.exe not found.
    pause
    exit /b 1
)

echo.
echo [2/3] Copying to C:\Windows...
copy /Y "%~dp0ExplorerProtocolHandler.exe" "C:\Windows\ExplorerProtocolHandler.exe"

if %errorLevel% neq 0 (
    echo ERROR: Failed to copy EXE to C:\Windows
    pause
    exit /b 1
)

echo.
echo [3/3] Registering protocol handler...
reg import "%~dp0register-explorer-protocol-exe.reg"

if %errorLevel% neq 0 (
    echo ERROR: Failed to import registry settings
    pause
    exit /b 1
)

echo.
echo [4/4] Configuring browser policy (Chrome/Edge)...
reg import "%~dp0allow-explorer-protocol-chrome.reg"

if %errorLevel% neq 0 (
    echo WARNING: Failed to import browser policy
    echo You may still see browser prompts
)

echo.
echo ====================================
echo SUCCESS! Installation complete.
echo ====================================
echo.
echo The explorer: protocol is now registered with NO PROMPTS!
echo.
echo IMPORTANT: Restart Chrome/Edge for the changes to take effect!
echo.
echo Test it:
echo 1. Close and restart your browser
echo 2. Go to http://localhost:3000
echo 3. Click any "Open Folder" link
echo 4. Windows Explorer should open directly - NO PROMPTS!
echo.
pause
