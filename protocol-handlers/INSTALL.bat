@echo off
setlocal enabledelayedexpansion
REM ============================================
REM Unified Protocol Handlers Installer
REM Installs both Explorer and CS Imaging protocols
REM Run as Administrator - Safe to run multiple times
REM ============================================

REM Installation directory
set INSTALL_DIR=C:\ShwanOrtho

echo ============================================
echo   Protocol Handlers Installer
echo ============================================
echo   Installing to: %INSTALL_DIR%
echo   - Explorer Protocol (folder opening)
echo   - CS Imaging Protocol (Trophy integration)
echo   - Dolphin Imaging Protocol (Dolphin integration)
echo   - Universal Protocol (launch any application)
echo ============================================
echo.

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click and select "Run as Administrator"
    pause
    exit /b 1
)

REM ============================================
REM Migration: Check for legacy C:\Windows installation
REM ============================================
if exist "C:\Windows\ProtocolHandlers.ini" (
    echo.
    echo [Migration] Detected legacy installation in C:\Windows
    echo.

    REM Create new installation directory
    if not exist "%INSTALL_DIR%" (
        mkdir "%INSTALL_DIR%"
    )

    REM Migrate INI file (preserve user settings)
    if not exist "%INSTALL_DIR%\ProtocolHandlers.ini" (
        echo   - Migrating configuration file...
        copy /Y "C:\Windows\ProtocolHandlers.ini" "%INSTALL_DIR%\" >nul
        echo   - Configuration migrated to %INSTALL_DIR%
    ) else (
        echo   - Configuration already exists in new location (preserving)
    )

    REM Clean up legacy files
    echo   - Removing legacy files from C:\Windows...
    del /f "C:\Windows\ExplorerProtocolHandler.exe" >nul 2>&1
    del /f "C:\Windows\CSImagingProtocolHandler.exe" >nul 2>&1
    del /f "C:\Windows\DolphinImagingProtocolHandler.exe" >nul 2>&1
    del /f "C:\Windows\UniversalProtocolHandler.exe" >nul 2>&1
    del /f "C:\Windows\3ShapeProtocolHandler.exe" >nul 2>&1
    del /f "C:\Windows\ProtocolHandlers.ini" >nul 2>&1
    del /f "C:\Windows\ProtocolHandlers.ini.backup" >nul 2>&1
    echo   - Legacy files removed
    echo.
)

echo [Step 1/5] Compiling protocol handlers...
echo.
powershell.exe -ExecutionPolicy Bypass -File "%~dp0compile-handlers.ps1"

if not exist "%~dp0ExplorerProtocolHandler.exe" (
    echo.
    echo ERROR: ExplorerProtocolHandler.exe not found after compilation!
    pause
    exit /b 1
)

if not exist "%~dp0CSImagingProtocolHandler.exe" (
    echo.
    echo ERROR: CSImagingProtocolHandler.exe not found after compilation!
    pause
    exit /b 1
)

if not exist "%~dp0UniversalProtocolHandler.exe" (
    echo.
    echo ERROR: UniversalProtocolHandler.exe not found after compilation!
    pause
    exit /b 1
)

if not exist "%~dp0DolphinImagingProtocolHandler.exe" (
    echo.
    echo ERROR: DolphinImagingProtocolHandler.exe not found after compilation!
    pause
    exit /b 1
)

echo.
echo [Step 2/5] Creating installation directory and configuration file...
echo.

REM Create installation directory if it doesn't exist
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    if !errorLevel! neq 0 (
        echo ERROR: Failed to create installation directory
        pause
        exit /b 1
    )
    echo   - Created installation directory: %INSTALL_DIR%
) else (
    echo   - Installation directory exists: %INSTALL_DIR%
)

REM Check if config file exists
if exist "%INSTALL_DIR%\ProtocolHandlers.ini" (
    echo   - Configuration file already exists
    echo   - Preserving existing settings
) else (
    echo   - Creating new configuration file
    copy /Y "%~dp0ProtocolHandlers.ini" "%INSTALL_DIR%\" >nul
    if !errorLevel! neq 0 (
        echo ERROR: Failed to create configuration file
        pause
        exit /b 1
    )
    echo   - Configuration file created: %INSTALL_DIR%\ProtocolHandlers.ini
)

echo.
echo [Step 3/5] Installing handlers to %INSTALL_DIR%...
echo.

REM Kill any running protocol handler processes (they may be cached by Windows)
taskkill /F /IM ExplorerProtocolHandler.exe >nul 2>&1
taskkill /F /IM CSImagingProtocolHandler.exe >nul 2>&1
taskkill /F /IM DolphinImagingProtocolHandler.exe >nul 2>&1
taskkill /F /IM UniversalProtocolHandler.exe >nul 2>&1
echo   - Stopped any running protocol handlers

REM Check if files already exist and compare
set NEEDS_COPY_EXPLORER=1
set NEEDS_COPY_CSIMAGING=1
set NEEDS_COPY_DOLPHIN=1
set NEEDS_COPY_UNIVERSAL=1

if exist "%INSTALL_DIR%\ExplorerProtocolHandler.exe" (
    fc /b "%~dp0ExplorerProtocolHandler.exe" "%INSTALL_DIR%\ExplorerProtocolHandler.exe" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   - ExplorerProtocolHandler.exe is up to date
        set NEEDS_COPY_EXPLORER=0
    ) else (
        echo   - Updating ExplorerProtocolHandler.exe
    )
) else (
    echo   - Installing ExplorerProtocolHandler.exe
)

if %NEEDS_COPY_EXPLORER% equ 1 (
    call :copy_with_retry ExplorerProtocolHandler.exe
    if !errorLevel! neq 0 (
        pause
        exit /b 1
    )
)

if exist "%INSTALL_DIR%\CSImagingProtocolHandler.exe" (
    fc /b "%~dp0CSImagingProtocolHandler.exe" "%INSTALL_DIR%\CSImagingProtocolHandler.exe" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   - CSImagingProtocolHandler.exe is up to date
        set NEEDS_COPY_CSIMAGING=0
    ) else (
        echo   - Updating CSImagingProtocolHandler.exe
    )
) else (
    echo   - Installing CSImagingProtocolHandler.exe
)

if %NEEDS_COPY_CSIMAGING% equ 1 (
    call :copy_with_retry CSImagingProtocolHandler.exe
    if !errorLevel! neq 0 (
        pause
        exit /b 1
    )
)

if exist "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" (
    fc /b "%~dp0DolphinImagingProtocolHandler.exe" "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   - DolphinImagingProtocolHandler.exe is up to date
        set NEEDS_COPY_DOLPHIN=0
    ) else (
        echo   - Updating DolphinImagingProtocolHandler.exe
    )
) else (
    echo   - Installing DolphinImagingProtocolHandler.exe
)

if %NEEDS_COPY_DOLPHIN% equ 1 (
    call :copy_with_retry DolphinImagingProtocolHandler.exe
    if !errorLevel! neq 0 (
        pause
        exit /b 1
    )
)

if exist "%INSTALL_DIR%\UniversalProtocolHandler.exe" (
    fc /b "%~dp0UniversalProtocolHandler.exe" "%INSTALL_DIR%\UniversalProtocolHandler.exe" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   - UniversalProtocolHandler.exe is up to date
        set NEEDS_COPY_UNIVERSAL=0
    ) else (
        echo   - Updating UniversalProtocolHandler.exe
    )
) else (
    echo   - Installing UniversalProtocolHandler.exe
)

if %NEEDS_COPY_UNIVERSAL% equ 1 (
    call :copy_with_retry UniversalProtocolHandler.exe
    if !errorLevel! neq 0 (
        pause
        exit /b 1
    )
)

echo.
echo [Step 4/5] Registering protocols in Windows registry...
echo.

REM Register protocol handlers
reg add "HKCR\explorer" /ve /t REG_SZ /d "URL:Explorer Protocol" /f >nul 2>&1
reg add "HKCR\explorer" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCR\explorer\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\ExplorerProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

reg add "HKCR\csimaging" /ve /t REG_SZ /d "URL:CS Imaging Protocol" /f >nul 2>&1
reg add "HKCR\csimaging" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCR\csimaging\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\CSImagingProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

reg add "HKCR\dolphin" /ve /t REG_SZ /d "URL:Dolphin Imaging Protocol" /f >nul 2>&1
reg add "HKCR\dolphin" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCR\dolphin\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\DolphinImagingProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

reg add "HKCR\launch" /ve /t REG_SZ /d "URL:Universal Application Launcher" /f >nul 2>&1
reg add "HKCR\launch" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCR\launch\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\UniversalProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

REM Smart browser policy handling
echo   - Configuring browser auto-launch policies...

REM For Chrome
set CHROME_POLICY="HKLM\SOFTWARE\Policies\Google\Chrome"
reg query %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    echo   - Chrome policy exists, updating...
) else (
    echo   - Chrome policy not found, creating...
)
reg add %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\": \"explorer\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"csimaging\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"dolphin\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"launch\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}]" /f >nul 2>&1

REM For Edge
set EDGE_POLICY="HKLM\SOFTWARE\Policies\Microsoft\Edge"
reg query %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    echo   - Edge policy exists, updating...
) else (
    echo   - Edge policy not found, creating...
)
reg add %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\": \"explorer\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"csimaging\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"dolphin\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"launch\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}]" /f >nul 2>&1

echo   - Protocols registered successfully

echo.
echo [Step 5/5] Verifying installation...
echo.

REM Verify files exist
set ALL_OK=1

if not exist "%INSTALL_DIR%\ProtocolHandlers.ini" (
    echo   X ProtocolHandlers.ini NOT FOUND
    set ALL_OK=0
) else (
    echo   + ProtocolHandlers.ini OK
)

if not exist "%INSTALL_DIR%\ExplorerProtocolHandler.exe" (
    echo   X ExplorerProtocolHandler.exe NOT FOUND
    set ALL_OK=0
) else (
    echo   + ExplorerProtocolHandler.exe OK
)

if not exist "%INSTALL_DIR%\CSImagingProtocolHandler.exe" (
    echo   X CSImagingProtocolHandler.exe NOT FOUND
    set ALL_OK=0
) else (
    echo   + CSImagingProtocolHandler.exe OK
)

if not exist "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" (
    echo   X DolphinImagingProtocolHandler.exe NOT FOUND
    set ALL_OK=0
) else (
    echo   + DolphinImagingProtocolHandler.exe OK
)

if not exist "%INSTALL_DIR%\UniversalProtocolHandler.exe" (
    echo   X UniversalProtocolHandler.exe NOT FOUND
    set ALL_OK=0
) else (
    echo   + UniversalProtocolHandler.exe OK
)

REM Verify registry keys exist
reg query "HKCR\explorer\shell\open\command" >nul 2>&1
if !errorLevel! equ 0 (
    echo   + explorer: protocol registered
) else (
    echo   X explorer: protocol NOT registered
    set ALL_OK=0
)

reg query "HKCR\csimaging\shell\open\command" >nul 2>&1
if !errorLevel! equ 0 (
    echo   + csimaging: protocol registered
) else (
    echo   X csimaging: protocol NOT registered
    set ALL_OK=0
)

reg query "HKCR\dolphin\shell\open\command" >nul 2>&1
if !errorLevel! equ 0 (
    echo   + dolphin: protocol registered
) else (
    echo   X dolphin: protocol NOT registered
    set ALL_OK=0
)

reg query "HKCR\launch\shell\open\command" >nul 2>&1
if !errorLevel! equ 0 (
    echo   + launch: protocol registered
) else (
    echo   X launch: protocol NOT registered
    set ALL_OK=0
)

echo.
echo ============================================

if !ALL_OK! equ 1 (
    echo   SUCCESS! Installation Complete
    echo ============================================
    echo.
    echo Next steps:
    echo 1. Edit configuration if needed:
    echo    - Open %INSTALL_DIR%\ProtocolHandlers.ini with Notepad
    echo    - Update PatientsFolder path if different from \\Clinic\clinic1
    echo 2. Restart your browser ^(Chrome/Edge^)
    echo 3. Test protocols:
    echo    - Click "Open Folder" on aligner sets
    echo    - Click "CS Imaging" in patient sidebar
    echo    - Click "Dolphin Imaging" in More Actions flyout
    echo    - Click "Print Labels" on aligner batch cards
    echo.
    echo The handlers are now active and ready to use!
) else (
    echo   WARNING! Installation may be incomplete
    echo ============================================
    echo.
    echo Some components failed to install.
    echo Please check the errors above.
)

echo.
pause
exit /b 0

REM ============================================
REM Subroutine: Copy file with retries
REM Usage: call :copy_with_retry filename.exe
REM Returns: errorLevel 0 on success, 1 on failure
REM ============================================
:copy_with_retry
set "_FILENAME=%~1"
set "_COPY_SUCCESS=0"

REM Attempt 1
copy /Y "%~dp0%_FILENAME%" "%INSTALL_DIR%\" >nul 2>&1
if !errorLevel! equ 0 set "_COPY_SUCCESS=1"

REM Attempt 2 (if needed)
if !_COPY_SUCCESS! equ 0 (
    timeout /t 2 /nobreak >nul
    copy /Y "%~dp0%_FILENAME%" "%INSTALL_DIR%\" >nul 2>&1
    if !errorLevel! equ 0 set "_COPY_SUCCESS=1"
)

REM Attempt 3 (if needed)
if !_COPY_SUCCESS! equ 0 (
    timeout /t 2 /nobreak >nul
    copy /Y "%~dp0%_FILENAME%" "%INSTALL_DIR%\" >nul 2>&1
    if !errorLevel! equ 0 set "_COPY_SUCCESS=1"
)

if !_COPY_SUCCESS! equ 0 (
    echo ERROR: Failed to copy %_FILENAME% after 3 attempts
    echo The file may be locked by Windows. Try:
    echo 1. Close all File Explorer windows
    echo 2. Wait a few seconds
    echo 3. Run the installer again
    exit /b 1
)
exit /b 0
