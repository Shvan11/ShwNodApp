# PowerShell script to compile all protocol handlers

# Change to script directory
Set-Location $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Protocol Handlers Compilation" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

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
Write-Host ""

$compiledCount = 0
$failedCount = 0

# Compile ExplorerProtocolHandler
Write-Host "[1/4] Compiling ExplorerProtocolHandler.cs..." -ForegroundColor Cyan

if (-not (Test-Path "source\ExplorerProtocolHandler.cs")) {
    Write-Host "ERROR: source\ExplorerProtocolHandler.cs not found!" -ForegroundColor Red
    $failedCount++
} else {
    & $cscPath /target:winexe /out:ExplorerProtocolHandler.exe /reference:System.Web.dll /reference:System.Windows.Forms.dll "source\ExplorerProtocolHandler.cs" 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SUCCESS: ExplorerProtocolHandler.exe created" -ForegroundColor Green
        $compiledCount++
    } else {
        Write-Host "  ERROR: Compilation failed" -ForegroundColor Red
        $failedCount++
    }
}

Write-Host ""

# Compile CSImagingProtocolHandler
Write-Host "[2/4] Compiling CSImagingProtocolHandler.cs..." -ForegroundColor Cyan

if (-not (Test-Path "source\CSImagingProtocolHandler.cs")) {
    Write-Host "ERROR: source\CSImagingProtocolHandler.cs not found!" -ForegroundColor Red
    $failedCount++
} else {
    & $cscPath /target:winexe /out:CSImagingProtocolHandler.exe /reference:System.Web.dll /reference:System.Windows.Forms.dll "source\CSImagingProtocolHandler.cs" 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SUCCESS: CSImagingProtocolHandler.exe created" -ForegroundColor Green
        $compiledCount++
    } else {
        Write-Host "  ERROR: Compilation failed" -ForegroundColor Red
        $failedCount++
    }
}

Write-Host ""

# Compile UniversalProtocolHandler
Write-Host "[3/4] Compiling UniversalProtocolHandler.cs..." -ForegroundColor Cyan

if (-not (Test-Path "source\UniversalProtocolHandler.cs")) {
    Write-Host "ERROR: source\UniversalProtocolHandler.cs not found!" -ForegroundColor Red
    $failedCount++
} else {
    & $cscPath /target:winexe /out:UniversalProtocolHandler.exe /reference:System.Web.dll /reference:System.Windows.Forms.dll "source\UniversalProtocolHandler.cs" 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SUCCESS: UniversalProtocolHandler.exe created" -ForegroundColor Green
        $compiledCount++
    } else {
        Write-Host "  ERROR: Compilation failed" -ForegroundColor Red
        $failedCount++
    }
}

Write-Host ""

# Compile DolphinImagingProtocolHandler
Write-Host "[4/4] Compiling DolphinImagingProtocolHandler.cs..." -ForegroundColor Cyan

if (-not (Test-Path "source\DolphinImagingProtocolHandler.cs")) {
    Write-Host "ERROR: source\DolphinImagingProtocolHandler.cs not found!" -ForegroundColor Red
    $failedCount++
} else {
    & $cscPath /target:winexe /out:DolphinImagingProtocolHandler.exe /reference:System.Web.dll /reference:System.Windows.Forms.dll "source\DolphinImagingProtocolHandler.cs" 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SUCCESS: DolphinImagingProtocolHandler.exe created" -ForegroundColor Green
        $compiledCount++
    } else {
        Write-Host "  ERROR: Compilation failed" -ForegroundColor Red
        $failedCount++
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Compilation Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Compiled: $compiledCount" -ForegroundColor Green
Write-Host "  Failed:   $failedCount" -ForegroundColor $(if ($failedCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failedCount -gt 0) {
    Write-Host "Some compilations failed. Please check the errors above." -ForegroundColor Red
    exit 1
}

Write-Host "All handlers compiled successfully!" -ForegroundColor Green
Write-Host "Ready to run INSTALL.bat" -ForegroundColor Yellow
