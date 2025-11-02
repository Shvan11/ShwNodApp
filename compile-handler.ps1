# PowerShell script to compile the Explorer Protocol Handler

# Change to script directory
Set-Location $PSScriptRoot

Write-Host "Compiling ExplorerProtocolHandler.cs..." -ForegroundColor Cyan
Write-Host "Working directory: $PWD" -ForegroundColor Gray

# Check if source file exists
if (-not (Test-Path "ExplorerProtocolHandler.cs")) {
    Write-Host "ERROR: ExplorerProtocolHandler.cs not found in current directory!" -ForegroundColor Red
    Write-Host "Make sure all files are in the same folder." -ForegroundColor Yellow
    exit 1
}

# Find the C# compiler (csc.exe) from .NET Framework
$cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $cscPath)) {
    Write-Host "ERROR: C# compiler not found at $cscPath" -ForegroundColor Red
    Write-Host "Trying to find it in PATH..." -ForegroundColor Yellow
    $cscPath = (Get-Command csc.exe -ErrorAction SilentlyContinue).Source

    if (-not $cscPath) {
        Write-Host "ERROR: Could not find csc.exe. Please install .NET Framework." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Using compiler: $cscPath" -ForegroundColor Green

# Compile the C# file
& $cscPath /target:exe /out:ExplorerProtocolHandler.exe /reference:System.Web.dll ExplorerProtocolHandler.cs

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSUCCESS! ExplorerProtocolHandler.exe created." -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Copy ExplorerProtocolHandler.exe to C:\Windows\" -ForegroundColor Yellow
    Write-Host "   Run: Copy-Item ExplorerProtocolHandler.exe C:\Windows\ -Force" -ForegroundColor Gray
    Write-Host "`n2. Run the registry file: register-explorer-protocol-exe.reg" -ForegroundColor Yellow
    Write-Host "`n3. Test in your browser - no more prompts!" -ForegroundColor Yellow
} else {
    Write-Host "`nERROR: Compilation failed." -ForegroundColor Red
}
