# [OpenClaw Build] Preparing Tauri environment...
$KeyPath = "$HOME\.tauri\openclaw.key"

# Check if the private key exists
if (!(Test-Path $KeyPath)) {
    Write-Host "[ERROR] Private key not found at $KeyPath" -ForegroundColor Red
    Write-Host "Please run the following command to generate it first:"
    Write-Host "cargo tauri signer generate -w `"$KeyPath`" --password 123 --force" -ForegroundColor Yellow
    Pause
    exit 1
}

# Read the private key content into environment variable
$env:TAURI_SIGNING_PRIVATE_KEY = [System.IO.File]::ReadAllText($KeyPath).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "123"

Write-Host "[OpenClaw Build] Private key loaded successfully." -ForegroundColor Green

Write-Host "[OpenClaw Build] Cleaning cargo cache..." -ForegroundColor Cyan
Set-Location -Path "src-tauri"
cargo clean
Set-Location -Path ".."

Write-Host "[OpenClaw Build] Starting pnpm installer:build..." -ForegroundColor Cyan

$env:BUILD_CONFIG = "release"
# Run the build
pnpm installer:build

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build failed with exit code $LASTEXITCODE." -ForegroundColor Red
    Pause
    exit $LASTEXITCODE
}

Write-Host "[OpenClaw Build] Build completed successfully." -ForegroundColor Green
Pause
