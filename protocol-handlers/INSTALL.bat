@echo off
setlocal enabledelayedexpansion
REM ============================================
REM Unified Protocol Handlers Installer
REM Installs selected protocol handlers
REM Run as Administrator - Safe to run multiple times
REM ============================================

REM Installation directory
set INSTALL_DIR=C:\ShwanOrtho

REM Component selection flags (default: all selected)
set INSTALL_EXPLORER=1
set INSTALL_CSIMAGING=1
set INSTALL_DOLPHIN=1
set INSTALL_3SHAPE=1

REM Check for admin rights first
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click and select "Run as Administrator"
    pause
    exit /b 1
)

REM Check for command-line arguments for silent/automated install
if "%~1"=="--all" goto :skip_menu
if "%~1"=="-a" goto :skip_menu
if "%~1"=="--help" goto :show_help
if "%~1"=="-h" goto :show_help

REM ============================================
REM Interactive Component Selection Menu
REM ============================================
:menu
cls
echo ============================================
echo   Protocol Handlers Installer
echo ============================================
echo   Install Location: %INSTALL_DIR%
echo ============================================
echo.
echo   Select components to install:
echo.
if !INSTALL_EXPLORER! equ 1 (echo   [X] 1. Explorer Protocol      - Open patient folders) else (echo   [ ] 1. Explorer Protocol      - Open patient folders)
if !INSTALL_CSIMAGING! equ 1 (echo   [X] 2. CS Imaging Protocol    - Trophy/Carestream integration) else (echo   [ ] 2. CS Imaging Protocol    - Trophy/Carestream integration)
if !INSTALL_DOLPHIN! equ 1 (echo   [X] 3. Dolphin Protocol       - Dolphin Imaging integration) else (echo   [ ] 3. Dolphin Protocol       - Dolphin Imaging integration)
if !INSTALL_3SHAPE! equ 1 (echo   [X] 4. 3Shape Protocol        - 3Shape scanner integration) else (echo   [ ] 4. 3Shape Protocol        - 3Shape scanner integration)
echo.
echo   ----------------------------------------
echo   A. Select All          N. Select None
echo   I. Install Selected    Q. Quit
echo   ----------------------------------------
echo.
set /p "CHOICE=Enter choice (1-4, A, N, I, Q): "

if /i "%CHOICE%"=="1" goto :toggle1
if /i "%CHOICE%"=="2" goto :toggle2
if /i "%CHOICE%"=="3" goto :toggle3
if /i "%CHOICE%"=="4" goto :toggle4
if /i "%CHOICE%"=="A" goto :selectall
if /i "%CHOICE%"=="N" goto :selectnone
if /i "%CHOICE%"=="I" goto :validate_selection
if /i "%CHOICE%"=="Q" goto :quit

echo Invalid choice. Press any key to try again...
pause >nul
goto :menu

:toggle1
set /a INSTALL_EXPLORER=1-INSTALL_EXPLORER
goto :menu

:toggle2
set /a INSTALL_CSIMAGING=1-INSTALL_CSIMAGING
goto :menu

:toggle3
set /a INSTALL_DOLPHIN=1-INSTALL_DOLPHIN
goto :menu

:toggle4
set /a INSTALL_3SHAPE=1-INSTALL_3SHAPE
goto :menu

:selectall
set INSTALL_EXPLORER=1
set INSTALL_CSIMAGING=1
set INSTALL_DOLPHIN=1
set INSTALL_3SHAPE=1
goto :menu

:selectnone
set INSTALL_EXPLORER=0
set INSTALL_CSIMAGING=0
set INSTALL_DOLPHIN=0
set INSTALL_3SHAPE=0
goto :menu

:quit
echo.
echo Installation cancelled.
pause
exit /b 0

:validate_selection
REM Check that at least one component is selected
set TOTAL_SELECTED=0
if !INSTALL_EXPLORER! equ 1 set /a TOTAL_SELECTED+=1
if !INSTALL_CSIMAGING! equ 1 set /a TOTAL_SELECTED+=1
if !INSTALL_DOLPHIN! equ 1 set /a TOTAL_SELECTED+=1
if !INSTALL_3SHAPE! equ 1 set /a TOTAL_SELECTED+=1

if !TOTAL_SELECTED! equ 0 (
    echo.
    echo ERROR: No components selected. Please select at least one.
    pause
    goto :menu
)

:skip_menu
cls
echo ============================================
echo   Protocol Handlers Installer
echo ============================================
echo   Installing to: %INSTALL_DIR%
echo.
echo   Selected components:
if !INSTALL_EXPLORER! equ 1 echo   - Explorer Protocol ^(folder opening^)
if !INSTALL_CSIMAGING! equ 1 echo   - CS Imaging Protocol ^(Trophy integration^)
if !INSTALL_DOLPHIN! equ 1 echo   - Dolphin Imaging Protocol ^(Dolphin integration^)
if !INSTALL_3SHAPE! equ 1 echo   - 3Shape Protocol ^(3Shape scanner integration^)
echo ============================================
echo.

goto :show_help_end

:show_help
echo ============================================
echo   Protocol Handlers Installer - Help
echo ============================================
echo.
echo Usage: INSTALL.bat [options]
echo.
echo Options:
echo   --all, -a     Install all components without menu
echo   --help, -h    Show this help message
echo.
echo Without options, an interactive menu is displayed.
echo.
pause
exit /b 0

:show_help_end

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

echo [Step 1/4] Compiling selected protocol handlers...
echo.
powershell.exe -ExecutionPolicy Bypass -File "%~dp0compile-handlers.ps1"

REM Verify compilation of selected components only
if !INSTALL_EXPLORER! equ 1 (
    if not exist "%~dp0ExplorerProtocolHandler.exe" (
        echo.
        echo ERROR: ExplorerProtocolHandler.exe not found after compilation!
        pause
        exit /b 1
    )
)

if !INSTALL_CSIMAGING! equ 1 (
    if not exist "%~dp0CSImagingProtocolHandler.exe" (
        echo.
        echo ERROR: CSImagingProtocolHandler.exe not found after compilation!
        pause
        exit /b 1
    )
)

if !INSTALL_DOLPHIN! equ 1 (
    if not exist "%~dp0DolphinImagingProtocolHandler.exe" (
        echo.
        echo ERROR: DolphinImagingProtocolHandler.exe not found after compilation!
        pause
        exit /b 1
    )
)

if !INSTALL_3SHAPE! equ 1 (
    if not exist "%~dp03ShapeProtocolHandler.exe" (
        echo.
        echo ERROR: 3ShapeProtocolHandler.exe not found after compilation!
        pause
        exit /b 1
    )
)

echo.
echo [Step 2/4] Creating installation directory and configuration file...
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
echo [Step 3/4] Installing selected handlers to %INSTALL_DIR%...
echo.

REM Kill running protocol handler processes for selected components
if !INSTALL_EXPLORER! equ 1 taskkill /F /IM ExplorerProtocolHandler.exe >nul 2>&1
if !INSTALL_CSIMAGING! equ 1 taskkill /F /IM CSImagingProtocolHandler.exe >nul 2>&1
if !INSTALL_DOLPHIN! equ 1 taskkill /F /IM DolphinImagingProtocolHandler.exe >nul 2>&1
if !INSTALL_3SHAPE! equ 1 taskkill /F /IM 3ShapeProtocolHandler.exe >nul 2>&1
echo   - Stopped any running protocol handlers

REM Check if files already exist and compare
set NEEDS_COPY_EXPLORER=1
set NEEDS_COPY_CSIMAGING=1
set NEEDS_COPY_DOLPHIN=1
set NEEDS_COPY_3SHAPE=1

REM Explorer Protocol Handler
if !INSTALL_EXPLORER! equ 1 (
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

    if !NEEDS_COPY_EXPLORER! equ 1 (
        call :copy_with_retry ExplorerProtocolHandler.exe
        if !errorLevel! neq 0 (
            pause
            exit /b 1
        )
    )
) else (
    echo   - Explorer Protocol: skipped ^(not selected^)
)

REM CS Imaging Protocol Handler
if !INSTALL_CSIMAGING! equ 1 (
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

    if !NEEDS_COPY_CSIMAGING! equ 1 (
        call :copy_with_retry CSImagingProtocolHandler.exe
        if !errorLevel! neq 0 (
            pause
            exit /b 1
        )
    )
) else (
    echo   - CS Imaging Protocol: skipped ^(not selected^)
)

REM Dolphin Imaging Protocol Handler
if !INSTALL_DOLPHIN! equ 1 (
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

    if !NEEDS_COPY_DOLPHIN! equ 1 (
        call :copy_with_retry DolphinImagingProtocolHandler.exe
        if !errorLevel! neq 0 (
            pause
            exit /b 1
        )
    )
) else (
    echo   - Dolphin Protocol: skipped ^(not selected^)
)

REM 3Shape Protocol Handler
if !INSTALL_3SHAPE! equ 1 (
    if exist "%INSTALL_DIR%\3ShapeProtocolHandler.exe" (
        fc /b "%~dp03ShapeProtocolHandler.exe" "%INSTALL_DIR%\3ShapeProtocolHandler.exe" >nul 2>&1
        if !errorLevel! equ 0 (
            echo   - 3ShapeProtocolHandler.exe is up to date
            set NEEDS_COPY_3SHAPE=0
        ) else (
            echo   - Updating 3ShapeProtocolHandler.exe
        )
    ) else (
        echo   - Installing 3ShapeProtocolHandler.exe
    )

    if !NEEDS_COPY_3SHAPE! equ 1 (
        call :copy_with_retry 3ShapeProtocolHandler.exe
        if !errorLevel! neq 0 (
            pause
            exit /b 1
        )
    )
) else (
    echo   - 3Shape Protocol: skipped ^(not selected^)
)

echo.
echo [Step 4/4] Registering selected protocols in Windows registry...
echo.

REM Register selected protocol handlers
if !INSTALL_EXPLORER! equ 1 (
    reg add "HKCR\explorer" /ve /t REG_SZ /d "URL:Explorer Protocol" /f >nul 2>&1
    reg add "HKCR\explorer" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
    reg add "HKCR\explorer\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\ExplorerProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1
    echo   - explorer: protocol registered
) else (
    echo   - explorer: skipped ^(not selected^)
)

if !INSTALL_CSIMAGING! equ 1 (
    reg add "HKCR\csimaging" /ve /t REG_SZ /d "URL:CS Imaging Protocol" /f >nul 2>&1
    reg add "HKCR\csimaging" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
    reg add "HKCR\csimaging\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\CSImagingProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1
    echo   - csimaging: protocol registered
) else (
    echo   - csimaging: skipped ^(not selected^)
)

if !INSTALL_DOLPHIN! equ 1 (
    reg add "HKCR\dolphin" /ve /t REG_SZ /d "URL:Dolphin Imaging Protocol" /f >nul 2>&1
    reg add "HKCR\dolphin" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
    reg add "HKCR\dolphin\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\DolphinImagingProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1
    echo   - dolphin: protocol registered
) else (
    echo   - dolphin: skipped ^(not selected^)
)

if !INSTALL_3SHAPE! equ 1 (
    reg add "HKCR\tshape" /ve /t REG_SZ /d "URL:3Shape Protocol" /f >nul 2>&1
    reg add "HKCR\tshape" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
    reg add "HKCR\tshape\shell\open\command" /ve /t REG_SZ /d "\"C:\\ShwanOrtho\\3ShapeProtocolHandler.exe\" \"%%1\"" /f >nul 2>&1
    echo   - tshape: protocol registered
) else (
    echo   - tshape: skipped ^(not selected^)
)

REM Smart browser policy handling
echo   - Configuring browser auto-launch policies ^(all protocols^)...

REM For Chrome
set CHROME_POLICY="HKLM\SOFTWARE\Policies\Google\Chrome"
reg query %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    echo   - Chrome policy exists, updating...
) else (
    echo   - Chrome policy not found, creating...
)
reg add %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\": \"explorer\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"csimaging\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"dolphin\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"tshape\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}]" /f >nul 2>&1

REM For Edge
set EDGE_POLICY="HKLM\SOFTWARE\Policies\Microsoft\Edge"
reg query %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    echo   - Edge policy exists, updating...
) else (
    echo   - Edge policy not found, creating...
)
reg add %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins /t REG_SZ /d "[{\"protocol\": \"explorer\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"csimaging\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"dolphin\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}, {\"protocol\": \"tshape\", \"allowed_origins\": [\"http://clinic:3000\", \"http://192.168.100.2:3000\", \"https://local.shwan-orthodontics.com\", \"https://remote.shwan-orthodontics.com\", \"http://localhost:3000\", \"http://192.168.100.2:5173\", \"http://localhost:5173\"]}]" /f >nul 2>&1

echo   - Protocols registered successfully

echo.
echo Verifying installation...
echo.

REM Verify files exist for selected components
set ALL_OK=1

if not exist "%INSTALL_DIR%\ProtocolHandlers.ini" (
    echo   X ProtocolHandlers.ini NOT FOUND
    set ALL_OK=0
) else (
    echo   + ProtocolHandlers.ini OK
)

REM Verify Explorer Protocol
if !INSTALL_EXPLORER! equ 1 (
    if not exist "%INSTALL_DIR%\ExplorerProtocolHandler.exe" (
        echo   X ExplorerProtocolHandler.exe NOT FOUND
        set ALL_OK=0
    ) else (
        echo   + ExplorerProtocolHandler.exe OK
    )
    reg query "HKCR\explorer\shell\open\command" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   + explorer: protocol registered
    ) else (
        echo   X explorer: protocol NOT registered
        set ALL_OK=0
    )
)

REM Verify CS Imaging Protocol
if !INSTALL_CSIMAGING! equ 1 (
    if not exist "%INSTALL_DIR%\CSImagingProtocolHandler.exe" (
        echo   X CSImagingProtocolHandler.exe NOT FOUND
        set ALL_OK=0
    ) else (
        echo   + CSImagingProtocolHandler.exe OK
    )
    reg query "HKCR\csimaging\shell\open\command" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   + csimaging: protocol registered
    ) else (
        echo   X csimaging: protocol NOT registered
        set ALL_OK=0
    )
)

REM Verify Dolphin Protocol
if !INSTALL_DOLPHIN! equ 1 (
    if not exist "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" (
        echo   X DolphinImagingProtocolHandler.exe NOT FOUND
        set ALL_OK=0
    ) else (
        echo   + DolphinImagingProtocolHandler.exe OK
    )
    reg query "HKCR\dolphin\shell\open\command" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   + dolphin: protocol registered
    ) else (
        echo   X dolphin: protocol NOT registered
        set ALL_OK=0
    )
)

REM Verify 3Shape Protocol
if !INSTALL_3SHAPE! equ 1 (
    if not exist "%INSTALL_DIR%\3ShapeProtocolHandler.exe" (
        echo   X 3ShapeProtocolHandler.exe NOT FOUND
        set ALL_OK=0
    ) else (
        echo   + 3ShapeProtocolHandler.exe OK
    )
    reg query "HKCR\tshape\shell\open\command" >nul 2>&1
    if !errorLevel! equ 0 (
        echo   + tshape: protocol registered
    ) else (
        echo   X tshape: protocol NOT registered
        set ALL_OK=0
    )
)

echo.
echo ============================================

if !ALL_OK! equ 1 (
    echo   SUCCESS! Installation Complete
    echo ============================================
    echo.
    echo Installed components:
    if !INSTALL_EXPLORER! equ 1 echo   - Explorer Protocol ^(explorer://^)
    if !INSTALL_CSIMAGING! equ 1 echo   - CS Imaging Protocol ^(csimaging://^)
    if !INSTALL_DOLPHIN! equ 1 echo   - Dolphin Protocol ^(dolphin://^)
    if !INSTALL_3SHAPE! equ 1 echo   - 3Shape Protocol ^(tshape://^)
    echo.
    echo Next steps:
    echo 1. Edit configuration if needed:
    echo    - Open %INSTALL_DIR%\ProtocolHandlers.ini with Notepad
    echo    - Update PatientsFolder path if different from \\Clinic\clinic1
    echo 2. Restart your browser ^(Chrome/Edge^)
    echo 3. Test installed protocols from the application
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
