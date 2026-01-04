@echo off
REM ============================================
REM Unified Protocol Handlers Uninstaller
REM Removes both Explorer and CS Imaging protocols
REM Run as Administrator
REM ============================================

REM Installation directory
set INSTALL_DIR=C:\ShwanOrtho

echo ============================================
echo   Protocol Handlers Uninstaller
echo ============================================
echo   Uninstalling from: %INSTALL_DIR%
echo   This will remove:
echo   - Explorer Protocol (folder opening)
echo   - CS Imaging Protocol (Trophy integration)
echo   - Dolphin Imaging Protocol (Dolphin integration)
echo   - Universal Protocol (application launcher)
echo   - All registry entries
echo   - Handler executables
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

echo WARNING: This will completely remove protocol handlers!
echo.
set /p CONFIRM="Type YES to continue: "

if /i not "%CONFIRM%"=="YES" (
    echo.
    echo Uninstall cancelled.
    pause
    exit /b 0
)

echo.
echo [Step 1/3] Removing registry entries...
echo.

REM Remove protocol handlers
reg query "HKCR\explorer" >nul 2>&1
if %errorLevel% equ 0 (
    reg delete "HKCR\explorer" /f >nul 2>&1
    echo   - explorer: protocol removed
) else (
    echo   - explorer: protocol not found (already removed)
)

reg query "HKCR\csimaging" >nul 2>&1
if %errorLevel% equ 0 (
    reg delete "HKCR\csimaging" /f >nul 2>&1
    echo   - csimaging: protocol removed
) else (
    echo   - csimaging: protocol not found (already removed)
)

reg query "HKCR\dolphin" >nul 2>&1
if %errorLevel% equ 0 (
    reg delete "HKCR\dolphin" /f >nul 2>&1
    echo   - dolphin: protocol removed
) else (
    echo   - dolphin: protocol not found (already removed)
)

reg query "HKCR\launch" >nul 2>&1
if %errorLevel% equ 0 (
    reg delete "HKCR\launch" /f >nul 2>&1
    echo   - launch: protocol removed
) else (
    echo   - launch: protocol not found (already removed)
)

REM Remove browser policies
set CHROME_POLICY="HKLM\SOFTWARE\Policies\Google\Chrome"
reg query %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    reg delete %CHROME_POLICY% /v AutoLaunchProtocolsFromOrigins /f >nul 2>&1
    echo   - Chrome auto-launch policy removed
) else (
    echo   - Chrome policy not found (already removed)
)

set EDGE_POLICY="HKLM\SOFTWARE\Policies\Microsoft\Edge"
reg query %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins >nul 2>&1
if %errorLevel% equ 0 (
    reg delete %EDGE_POLICY% /v AutoLaunchProtocolsFromOrigins /f >nul 2>&1
    echo   - Edge auto-launch policy removed
) else (
    echo   - Edge policy not found (already removed)
)

echo.
echo [Step 2/4] Deleting handler executables...
echo.

if exist "%INSTALL_DIR%\ExplorerProtocolHandler.exe" (
    del /f "%INSTALL_DIR%\ExplorerProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - ExplorerProtocolHandler.exe deleted
    ) else (
        echo   - Warning: Could not delete ExplorerProtocolHandler.exe
    )
) else (
    echo   - ExplorerProtocolHandler.exe not found (already removed)
)

if exist "%INSTALL_DIR%\CSImagingProtocolHandler.exe" (
    del /f "%INSTALL_DIR%\CSImagingProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - CSImagingProtocolHandler.exe deleted
    ) else (
        echo   - Warning: Could not delete CSImagingProtocolHandler.exe
    )
) else (
    echo   - CSImagingProtocolHandler.exe not found (already removed)
)

if exist "%INSTALL_DIR%\UniversalProtocolHandler.exe" (
    del /f "%INSTALL_DIR%\UniversalProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - UniversalProtocolHandler.exe deleted
    ) else (
        echo   - Warning: Could not delete UniversalProtocolHandler.exe
    )
) else (
    echo   - UniversalProtocolHandler.exe not found (already removed)
)

if exist "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" (
    del /f "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - DolphinImagingProtocolHandler.exe deleted
    ) else (
        echo   - Warning: Could not delete DolphinImagingProtocolHandler.exe
    )
) else (
    echo   - DolphinImagingProtocolHandler.exe not found (already removed)
)

REM Also clean up CS Imaging cache if it exists
if exist "C:\ProgramData\ShwanOrtho\csimaging-cache.txt" (
    del /f "C:\ProgramData\ShwanOrtho\csimaging-cache.txt" >nul 2>&1
    echo   - Removed CS Imaging cache file
)

echo.
echo [Step 3/4] Deleting configuration file...
echo.

if exist "%INSTALL_DIR%\ProtocolHandlers.ini" (
    del /f "%INSTALL_DIR%\ProtocolHandlers.ini" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - ProtocolHandlers.ini deleted
    ) else (
        echo   - Warning: Could not delete ProtocolHandlers.ini
    )
) else (
    echo   - ProtocolHandlers.ini not found (already removed)
)

if exist "%INSTALL_DIR%\ProtocolHandlers.ini.backup" (
    del /f "%INSTALL_DIR%\ProtocolHandlers.ini.backup" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - ProtocolHandlers.ini.backup deleted
    ) else (
        echo   - Warning: Could not delete ProtocolHandlers.ini.backup
    )
) else (
    echo   - ProtocolHandlers.ini.backup not found (already removed)
)

REM Remove installation directory if empty
dir /b "%INSTALL_DIR%" 2>nul | findstr . >nul 2>&1
if %errorLevel% neq 0 (
    rmdir "%INSTALL_DIR%" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   - Removed empty installation directory
    )
)

echo.
echo [Step 4/4] Verifying removal...
echo.

set ALL_REMOVED=1

REM Check if files still exist
if exist "%INSTALL_DIR%\ProtocolHandlers.ini" (
    echo   X ProtocolHandlers.ini still exists
    set ALL_REMOVED=0
) else (
    echo   + ProtocolHandlers.ini removed
)

if exist "%INSTALL_DIR%\ExplorerProtocolHandler.exe" (
    echo   X ExplorerProtocolHandler.exe still exists
    set ALL_REMOVED=0
) else (
    echo   + ExplorerProtocolHandler.exe removed
)

if exist "%INSTALL_DIR%\CSImagingProtocolHandler.exe" (
    echo   X CSImagingProtocolHandler.exe still exists
    set ALL_REMOVED=0
) else (
    echo   + CSImagingProtocolHandler.exe removed
)

if exist "%INSTALL_DIR%\UniversalProtocolHandler.exe" (
    echo   X UniversalProtocolHandler.exe still exists
    set ALL_REMOVED=0
) else (
    echo   + UniversalProtocolHandler.exe removed
)

if exist "%INSTALL_DIR%\DolphinImagingProtocolHandler.exe" (
    echo   X DolphinImagingProtocolHandler.exe still exists
    set ALL_REMOVED=0
) else (
    echo   + DolphinImagingProtocolHandler.exe removed
)

REM Check if registry keys still exist
reg query "HKCR\explorer" >nul 2>&1
if %errorLevel% equ 0 (
    echo   X explorer: protocol still registered
    set ALL_REMOVED=0
) else (
    echo   + explorer: protocol removed
)

reg query "HKCR\csimaging" >nul 2>&1
if %errorLevel% equ 0 (
    echo   X csimaging: protocol still registered
    set ALL_REMOVED=0
) else (
    echo   + csimaging: protocol removed
)

reg query "HKCR\dolphin" >nul 2>&1
if %errorLevel% equ 0 (
    echo   X dolphin: protocol still registered
    set ALL_REMOVED=0
) else (
    echo   + dolphin: protocol removed
)

reg query "HKCR\launch" >nul 2>&1
if %errorLevel% equ 0 (
    echo   X launch: protocol still registered
    set ALL_REMOVED=0
) else (
    echo   + launch: protocol removed
)

echo.
echo ============================================

if %ALL_REMOVED% equ 1 (
    echo   SUCCESS! Uninstall Complete
    echo ============================================
    echo.
    echo All protocol handlers have been removed.
    echo.
    echo Next steps:
    echo 1. Restart your browser ^(Chrome/Edge^)
    echo 2. The protocols will no longer work
    echo.
    echo To reinstall, run INSTALL.bat
) else (
    echo   WARNING! Uninstall may be incomplete
    echo ============================================
    echo.
    echo Some components could not be removed.
    echo They may be in use. Please:
    echo 1. Close your browser
    echo 2. Run this uninstaller again
)

echo.
pause
