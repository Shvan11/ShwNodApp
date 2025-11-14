@echo off
REM Emergency Admin Password Reset - Windows Batch File
REM Double-click this file to reset admin password

echo.
echo ========================================
echo   EMERGENCY PASSWORD RESET
echo ========================================
echo.
echo This will reset the admin password.
echo.
pause

npm run auth:emergency-reset

pause
