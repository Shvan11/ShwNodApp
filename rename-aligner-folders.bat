@echo off
REM ============================================================================
REM Aligner Folders Renaming Script
REM Renames patient name folders to PersonID folders
REM ============================================================================
REM
REM USAGE:
REM   1. Edit patient-mappings.txt with your patient data
REM   2. Run with /preview to see what will be renamed (DRY RUN)
REM   3. Run with /execute to actually rename folders
REM
REM EXAMPLES:
REM   rename-aligner-folders.bat /preview    - Show what will be renamed
REM   rename-aligner-folders.bat /execute    - Actually rename folders
REM
REM ============================================================================

setlocal EnableDelayedExpansion

REM Configuration
set "BASE_PATH=%~dp0"
set "MAPPINGS_FILE=%~dp0patient-mappings.txt"
set "LOG_FILE=%~dp0rename-log-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.txt"
set "LOG_FILE=!LOG_FILE: =0!"

REM Check command line argument
set "MODE=%1"
if "%MODE%"=="" (
    echo ERROR: No mode specified!
    echo.
    echo Usage:
    echo   %~nx0 /preview    - Preview changes without renaming
    echo   %~nx0 /execute    - Execute the rename operation
    echo.
    exit /b 1
)

if not "%MODE%"=="/preview" if not "%MODE%"=="/execute" (
    echo ERROR: Invalid mode '%MODE%'
    echo Must be /preview or /execute
    exit /b 1
)

REM Check if mappings file exists
if not exist "%MAPPINGS_FILE%" (
    echo ERROR: Mappings file '%MAPPINGS_FILE%' not found!
    echo.
    echo Please create the file with format:
    echo PersonID^|PatientName
    echo.
    echo Example:
    echo 92^|Patient_Name_1
    echo 5109^|Patient_Name_2
    echo 5635^|Patient_Name_3
    echo.
    exit /b 1
)

REM Check if base path exists
if not exist "%BASE_PATH%" (
    echo ERROR: Base path '%BASE_PATH%' not found!
    echo Please ensure the network path is accessible.
    exit /b 1
)

REM Initialize log
echo ============================================================================ > "%LOG_FILE%"
echo Aligner Folders Rename Log >> "%LOG_FILE%"
echo Started: %date% %time% >> "%LOG_FILE%"
echo Mode: %MODE% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

REM Display header
echo.
echo ============================================================================
echo Aligner Folders Renaming Script
echo ============================================================================
echo Mode: %MODE%
echo Base Path: %BASE_PATH%
echo Mappings File: %MAPPINGS_FILE%
echo Log File: %LOG_FILE%
echo ============================================================================
echo.

REM Count operations
set /a TOTAL_COUNT=0
set /a SUCCESS_COUNT=0
set /a SKIP_COUNT=0
set /a ERROR_COUNT=0

REM Process each line in the mappings file
for /f "usebackq tokens=1,2 delims=|" %%A in ("%MAPPINGS_FILE%") do (
    set "PERSON_ID=%%A"
    set "PATIENT_NAME=%%B"

    REM Skip header line if present
    if not "!PERSON_ID!"=="PersonID" (
        set /a TOTAL_COUNT+=1

        REM Construct paths
        set "OLD_PATH=%BASE_PATH%!PATIENT_NAME!"
        set "NEW_PATH=%BASE_PATH%!PERSON_ID!"

        REM Check if old folder exists
        if exist "!OLD_PATH!" (
            REM Check if new folder already exists
            if exist "!NEW_PATH!" (
                echo [SKIP] Folder already exists: !NEW_PATH!
                echo [SKIP] Old: !OLD_PATH! ^| New: !NEW_PATH! - Target already exists >> "%LOG_FILE%"
                set /a SKIP_COUNT+=1
            ) else (
                if "%MODE%"=="/preview" (
                    echo [PREVIEW] Would rename:
                    echo           From: !OLD_PATH!
                    echo           To:   !NEW_PATH!
                    echo [PREVIEW] From: !OLD_PATH! ^| To: !NEW_PATH! >> "%LOG_FILE%"
                    set /a SUCCESS_COUNT+=1
                ) else (
                    echo [RENAME] Renaming:
                    echo          From: !OLD_PATH!
                    echo          To:   !NEW_PATH!

                    REM Actually perform the rename
                    ren "!OLD_PATH!" "!PERSON_ID!" 2>nul

                    if !ERRORLEVEL! equ 0 (
                        echo [SUCCESS] Renamed successfully!
                        echo [SUCCESS] From: !OLD_PATH! ^| To: !NEW_PATH! >> "%LOG_FILE%"
                        set /a SUCCESS_COUNT+=1
                    ) else (
                        echo [ERROR] Failed to rename folder!
                        echo [ERROR] From: !OLD_PATH! ^| To: !NEW_PATH! >> "%LOG_FILE%"
                        set /a ERROR_COUNT+=1
                    )
                )
            )
        ) else (
            echo [NOT FOUND] Folder does not exist: !OLD_PATH!
            echo [NOT FOUND] !OLD_PATH! >> "%LOG_FILE%"
            set /a SKIP_COUNT+=1
        )
        echo.
    )
)

REM Summary
echo ============================================================================ >> "%LOG_FILE%"
echo Summary >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"
echo Total entries processed: %TOTAL_COUNT% >> "%LOG_FILE%"
if "%MODE%"=="/preview" (
    echo Folders that would be renamed: %SUCCESS_COUNT% >> "%LOG_FILE%"
) else (
    echo Successfully renamed: %SUCCESS_COUNT% >> "%LOG_FILE%"
)
echo Skipped: %SKIP_COUNT% >> "%LOG_FILE%"
echo Errors: %ERROR_COUNT% >> "%LOG_FILE%"
echo Completed: %date% %time% >> "%LOG_FILE%"

echo ============================================================================
echo Summary
echo ============================================================================
echo Total entries processed: %TOTAL_COUNT%
if "%MODE%"=="/preview" (
    echo Folders that would be renamed: %SUCCESS_COUNT%
) else (
    echo Successfully renamed: %SUCCESS_COUNT%
)
echo Skipped: %SKIP_COUNT%
echo Errors: %ERROR_COUNT%
echo ============================================================================
echo.
echo Log file created: %LOG_FILE%
echo.

endlocal
