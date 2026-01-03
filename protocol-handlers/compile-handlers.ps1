# PowerShell script to compile all protocol handlers

# Change to script directory
Set-Location $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Protocol Handlers Compilation" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Find the best available C# compiler
# Priority: 1) Visual Studio Roslyn, 2) .NET SDK, 3) Legacy .NET Framework
$cscPath = $null
$compilerType = "Unknown"

# 1. Try to find Visual Studio's Roslyn compiler (supports C# 6+)
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -requires Microsoft.Component.MSBuild -property installationPath 2>$null
    if ($vsPath) {
        # Look for Roslyn csc.exe in VS installation
        $roslynPath = Get-ChildItem -Path "$vsPath\MSBuild" -Recurse -Filter "csc.exe" -ErrorAction SilentlyContinue |
                      Where-Object { $_.FullName -like "*Roslyn*" } |
                      Select-Object -First 1
        if ($roslynPath) {
            $cscPath = $roslynPath.FullName
            $compilerType = "Visual Studio Roslyn (C# 10+)"
        }
    }
}

# 2. Try .NET SDK compiler
if (-not $cscPath) {
    $dotnetPath = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
    if ($dotnetPath) {
        # We can use 'dotnet build' but for simple .cs files, let's find the SDK's csc
        $sdkPath = Split-Path (Split-Path $dotnetPath)
        $sdkCsc = Get-ChildItem -Path "$sdkPath\sdk" -Recurse -Filter "csc.dll" -ErrorAction SilentlyContinue |
                  Sort-Object { [version]($_.Directory.Parent.Name -replace '[^\d.]') } -Descending |
                  Select-Object -First 1
        if ($sdkCsc) {
            # For .NET SDK, we need to use 'dotnet exec' to run csc.dll
            # But it's easier to just use the legacy compiler for Windows Forms apps
            Write-Host "  Found .NET SDK but using legacy compiler for Windows Forms compatibility" -ForegroundColor Yellow
        }
    }
}

# 3. Fall back to legacy .NET Framework compiler
if (-not $cscPath) {
    $legacyPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (Test-Path $legacyPath) {
        $cscPath = $legacyPath
        $compilerType = "Legacy .NET Framework (C# 5)"
        Write-Host "  Note: Using legacy compiler. Code must be C# 5 compatible." -ForegroundColor Yellow
        Write-Host "  Install Visual Studio for C# 6+ features." -ForegroundColor Yellow
    }
}

# 4. Last resort - check PATH
if (-not $cscPath) {
    $cscPath = (Get-Command csc.exe -ErrorAction SilentlyContinue).Source
    if ($cscPath) {
        $compilerType = "From PATH"
    }
}

if (-not $cscPath) {
    Write-Host "ERROR: Could not find any C# compiler!" -ForegroundColor Red
    Write-Host "Please install Visual Studio or .NET Framework." -ForegroundColor Red
    exit 1
}

Write-Host "Using compiler: $cscPath" -ForegroundColor Green
Write-Host "Compiler type:  $compilerType" -ForegroundColor Green
Write-Host ""

$compiledCount = 0
$failedCount = 0

# Compile ExplorerProtocolHandler
Write-Host "[1/5] Compiling ExplorerProtocolHandler.cs..." -ForegroundColor Cyan

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
Write-Host "[2/5] Compiling CSImagingProtocolHandler.cs..." -ForegroundColor Cyan

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
Write-Host "[3/5] Compiling UniversalProtocolHandler.cs..." -ForegroundColor Cyan

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
Write-Host "[4/5] Compiling DolphinImagingProtocolHandler.cs..." -ForegroundColor Cyan

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

# Compile 3ShapeProtocolHandler
Write-Host "[5/5] Compiling 3ShapeProtocolHandler.cs..." -ForegroundColor Cyan

if (-not (Test-Path "source\3ShapeProtocolHandler.cs")) {
    Write-Host "ERROR: source\3ShapeProtocolHandler.cs not found!" -ForegroundColor Red
    $failedCount++
} else {
    & $cscPath /target:winexe /out:3ShapeProtocolHandler.exe /reference:System.Web.dll /reference:System.Windows.Forms.dll "source\3ShapeProtocolHandler.cs" 2>&1 | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  SUCCESS: 3ShapeProtocolHandler.exe created" -ForegroundColor Green
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
