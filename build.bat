@echo off
setlocal enabledelayedexpansion

echo [OpenClaw Build] Preparing Tauri environment...

:: Check if the private key exists
set "KEY_PATH=%USERPROFILE%\.tauri\openclaw.key"
if not exist "%KEY_PATH%" (
    echo [ERROR] Private key not found at %KEY_PATH%
    echo Please run the following command to generate it first:
    echo cargo tauri signer generate -w "%KEY_PATH%" --password 123 --force
    pause
    exit /b 1
)

:: Read the private key content into environment variable
set /p TAURI_SIGNING_PRIVATE_KEY=<"%KEY_PATH%"
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=123

echo [OpenClaw Build] Private key loaded successfully.
echo [OpenClaw Build] Cleaning cargo cache...

cd src-tauri
call cargo clean
cd ..

echo [OpenClaw Build] Starting pnpm installer:build...

set BUILD_CONFIG=release
call pnpm installer:build

if %errorlevel% neq 0 (
    echo [ERROR] Build failed with exit code %errorlevel%.
    pause
    exit /b %errorlevel%
)

echo [OpenClaw Build] Build completed successfully.
pause
