@echo off
setlocal enabledelayedexpansion
REM ============================================
REM Unified Protocol Handlers Installer
REM Installs both Explorer and CS Imaging protocols
REM Run as Administrator - Safe to run multiple times
REM ============================================

echo ============================================
echo   Protocol Handlers Installer
echo ============================================
echo   Installing:
echo   - Explorer Protocol (folder opening)
echo   - CS Imaging Protocol (Trophy integration)
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

echo [Step 1/4] Compiling protocol handlers...
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

echo.
echo [Step 2/4] Creating/updating configuration file...
echo.

REM Check if config file exists
if exist "C:\Windows\ProtocolHandlers.ini" (
    echo   - Configuration file already exists
    echo   - Preserving existing settings
) else (
    echo   - Creating new configuration file
    copy /Y "%~dp0ProtocolHandlers.ini" "C:\Windows\" >nul
    if %errorLevel% neq 0 (
        echo ERROR: Failed to create configuration file
        pause
        exit /b 1
    )
    echo   - Configuration file created: C:\Windows\ProtocolHandlers.ini
)

echo.
echo [Step 3/4] Installing handlers to C:\Windows\...
echo.

REM Kill any running protocol handler processes (they may be cached by Windows)
taskkill /F /IM ExplorerProtocolHandler.exe >nul 2>&1
taskkill /F /IM CSImagingProtocolHandler.exe >nul 2>&1
taskkill /F /IM UniversalProtocolHandler.exe >nul 2>&1
echo   - Stopped any running protocol handlers

REM Check if files already exist and compare
set NEEDS_COPY_EXPLORER=1
set NEEDS_COPY_CSIMAGING=1
set NEEDS_COPY_UNIVERSAL=1

if exist "C:\Windows\ExplorerProtocolHandler.exe" (
    fc /b "%~dp0ExplorerProtocolHandler.exe" "C:\Windows\ExplorerProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - ExplorerProtocolHandler.exe is up to date
        set NEEDS_COPY_EXPLORER=0
    ) else (
        echo   - Updating ExplorerProtocolHandler.exe
    )
) else (
    echo   - Installing ExplorerProtocolHandler.exe
)

if %NEEDS_COPY_EXPLORER% equ 1 (
    REM Try to copy with retries (file may be locked temporarily)
    set COPY_SUCCESS=0
    for /L %%i in (1,1,3) do (
        copy /Y "%~dp0ExplorerProtocolHandler.exe" "C:\Windows\" >nul 2>&1
        if !errorLevel! equ 0 (
            set COPY_SUCCESS=1
            goto :explorer_copied
        )
        if %%i lss 3 (
            timeout /t 2 /nobreak >nul
        )
    )
    :explorer_copied
    if !COPY_SUCCESS! equ 0 (
        echo ERROR: Failed to copy ExplorerProtocolHandler.exe after 3 attempts
        echo The file may be locked by Windows. Try:
        echo 1. Close all File Explorer windows
        echo 2. Wait a few seconds
        echo 3. Run the installer again
        pause
        exit /b 1
    )
)

if exist "C:\Windows\CSImagingProtocolHandler.exe" (
    fc /b "%~dp0CSImagingProtocolHandler.exe" "C:\Windows\CSImagingProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - CSImagingProtocolHandler.exe is up to date
        set NEEDS_COPY_CSIMAGING=0
    ) else (
        echo   - Updating CSImagingProtocolHandler.exe
    )
) else (
    echo   - Installing CSImagingProtocolHandler.exe
)

if %NEEDS_COPY_CSIMAGING% equ 1 (
    REM Try to copy with retries (file may be locked temporarily)
    set COPY_SUCCESS=0
    for /L %%i in (1,1,3) do (
        copy /Y "%~dp0CSImagingProtocolHandler.exe" "C:\Windows\" >nul 2>&1
        if !errorLevel! equ 0 (
            set COPY_SUCCESS=1
            goto :csimaging_copied
        )
        if %%i lss 3 (
            timeout /t 2 /nobreak >nul
        )
    )
    :csimaging_copied
    if !COPY_SUCCESS! equ 0 (
        echo ERROR: Failed to copy CSImagingProtocolHandler.exe after 3 attempts
        echo The file may be locked by Windows. Try:
        echo 1. Close all File Explorer windows
        echo 2. Wait a few seconds
        echo 3. Run the installer again
        pause
        exit /b 1
    )
)

if exist "C:\Windows\UniversalProtocolHandler.exe" (
    fc /b "%~dp0UniversalProtocolHandler.exe" "C:\Windows\UniversalProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - UniversalProtocolHandler.exe is up to date
        set NEEDS_COPY_UNIVERSAL=0
    ) else (
        echo   - Updating UniversalProtocolHandler.exe
    )
) else (
    echo   - Installing UniversalProtocolHandler.exe
)

if %NEEDS_COPY_UNIVERSAL% equ 1 (
    REM Try to copy with retries (file may be locked temporarily)
    set COPY_SUCCESS=0
    for /L %%i in (1,1,3) do (
        copy /Y "%~dp0UniversalProtocolHandler.exe" "C:\Windows\" >nul 2>&1
        if !errorLevel! equ 0 (
            set COPY_SUCCESS=1
            goto :universal_copied
        )
        if %%i lss 3 (
            timeout /t 2 /nobreak >nul
        )
    )
    :universal_copied
    if !COPY_SUCCESS! equ 0 (
        echo ERROR: Failed to copy UniversalProtocolHandler.exe after 3 attempts
        echo The file may be locked by Windows. Try:
        echo 1. Close all File Explorer windows
        echo 2. Wait a few seconds
        echo 3. Run the installer again
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
reg add "HKCR\explorer\shell\open\command" /ve /t REG_SZ /d "\"C:\\Windows\\ExplorerProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

reg add "HKCR\csimaging" /ve /t REG_SZ /d "URL:CS Imaging Protocol" /f >nul 2>&1
reg add "HKCR\csimaging" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCR\csimaging\shell\open\command" /ve /t REG_SZ /d "\"C:\\Windows\\CSImagingProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

reg add "HKCR\launch" /ve /t REG_SZ /d "URL:Universal Application Launcher" /f >nul 2>&1
reg add "HKCR\launch" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCR\launch\shell\open\command" /ve /t REG_SZ /d "\"C:\\Windows\\UniversalProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1

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
reg add %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\": \"explorer\", \"allowed_origins\": [\"http://clinic:3000\"]}, {\"protocol\": \"csimaging\", \"allowed_origins\": [\"http://clinic:3000\"]}, {\"protocol\": \"launch\", \"allowed_origins\": [\"http://clinic:3000\"]}]" /f >nul 2>&1

REM For Edge
set EDGE_POLICY="HKLM\SOFTWARE\Policies\Microsoft\Edge"
reg query %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    echo   - Edge policy exists, updating...
) else (
    echo   - Edge policy not found, creating...
)
reg add %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\": \"explorer\", \"allowed_origins\": [\"http://clinic:3000\"]}, {\"protocol\": \"csimaging\", \"allowed_origins\": [\"http://clinic:3000\"]}, {\"protocol\": \"launch\", \"allowed_origins\": [\"http://clinic:3000\"]}]" /f >nul 2>&1

echo   - Protocols registered successfully

echo.
echo [Step 5/5] Verifying installation...
echo.

REM Verify files exist
set ALL_OK=1

if not exist "C:\Windows\ProtocolHandlers.ini" (
    echo   X ProtocolHandlers.ini NOT FOUND
    set ALL_OK=0
) else (
    echo   + ProtocolHandlers.ini OK
)

if not exist "C:\Windows\ExplorerProtocolHandler.exe" (
    echo   X ExplorerProtocolHandler.exe NOT FOUND
    set ALL_OK=0
) else (
    echo   + ExplorerProtocolHandler.exe OK
)

if not exist "C:\Windows\CSImagingProtocolHandler.exe" (
    echo   X CSImagingProtocolHandler.exe NOT FOUND
    set ALL_OK=0
) else (
    echo   + CSImagingProtocolHandler.exe OK
)

if not exist "C:\Windows\UniversalProtocolHandler.exe" (
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
    echo    - Open C:\Windows\ProtocolHandlers.ini with Notepad
    echo    - Update PatientsFolder path if different from \\Clinic\clinic1
    echo 2. Restart your browser (Chrome/Edge)
    echo 3. Test protocols:
    echo    - Click "Open Folder" on aligner sets
    echo    - Click "CS Imaging" in patient sidebar
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
