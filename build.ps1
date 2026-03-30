$ErrorActionPreference = "Stop"

# [OpenClaw Build] Preparing Tauri environment...
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$KeyPath = Join-Path $HOME ".tauri\openclaw.key"
$ExitCode = 0

Push-Location $ScriptRoot
try {
    # Check if the private key exists
    if (!(Test-Path $KeyPath)) {
        $ExitCode = 1
        Write-Host "[ERROR] Private key not found at $KeyPath" -ForegroundColor Red
        Write-Host "Please run the following command to generate it first:"
        Write-Host "cargo tauri signer generate -w `"$KeyPath`" --password 123 --force" -ForegroundColor Yellow
        throw "Private key not found"
    }

    # Read the private key content into environment variable
    $env:TAURI_SIGNING_PRIVATE_KEY = [System.IO.File]::ReadAllText($KeyPath).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "123"

    Write-Host "[OpenClaw Build] Private key loaded successfully." -ForegroundColor Green

    Write-Host "[OpenClaw Build] Cleaning cargo cache..." -ForegroundColor Cyan
    Set-Location -Path (Join-Path $ScriptRoot "src-tauri")
    cargo clean
    if ($LASTEXITCODE -ne 0) {
        $ExitCode = $LASTEXITCODE
        throw "cargo clean failed with exit code $LASTEXITCODE."
    }

    Set-Location -Path $ScriptRoot

    Write-Host "[OpenClaw Build] Starting build..." -ForegroundColor Cyan

    $env:BUILD_CONFIG = "release"
    node scripts/build-installer.js

    if ($LASTEXITCODE -ne 0) {
        $ExitCode = $LASTEXITCODE
        throw "Build failed with exit code $LASTEXITCODE."
    }

    Write-Host "[OpenClaw Build] Build completed successfully." -ForegroundColor Green
    Pause
}
catch {
    if ($ExitCode -eq 0) {
        $ExitCode = 1
    }
    if ($_.Exception.Message -ne "Private key not found") {
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
    Pause
    exit $ExitCode
}
finally {
    Pop-Location
}
