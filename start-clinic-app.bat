@echo off
REM Launch Shwan Orthodontics App with Silent Printing
REM This enables automatic printing without print dialog

echo Starting Clinic App with Silent Printing...

REM IMPORTANT: Replace "YOUR_PRINTER_NAME" with your actual thermal printer name
REM To find printer name: Control Panel > Devices > Printers & Scanners
REM Copy the exact printer name (example: "EPSON TM-T88V" or "POS-80")

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --printer-name="YOUR_PRINTER_NAME" --app=http://192.168.100.2:5173

REM Alternative: Use default printer (if you don't want to specify)
REM start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --app=http://192.168.100.2:5173
