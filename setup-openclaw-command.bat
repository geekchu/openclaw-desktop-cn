@echo off
chcp 65001 >nul
echo ========================================
echo   OpenClaw 命令设置工具
echo ========================================
echo.

REM 获取 OpenClaw 安装目录（假设在 Program Files）
set "OPENCLAW_DIR=%ProgramFiles%\OpenClaw"
if not exist "%OPENCLAW_DIR%" (
    set "OPENCLAW_DIR=%LocalAppData%\Programs\OpenClaw"
)

if not exist "%OPENCLAW_DIR%" (
    echo [错误] 未找到 OpenClaw 安装目录
    echo 请确保 OpenClaw 已正确安装
    pause
    exit /b 1
)

REM 查找 gateway bundle
set "BUNDLE_DIR=%OPENCLAW_DIR%\resources\gateway-bundle"
if not exist "%BUNDLE_DIR%\dist\entry.js" (
    echo [错误] 未找到 gateway bundle
    echo 路径: %BUNDLE_DIR%
    pause
    exit /b 1
)

REM 查找 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

for /f "delims=" %%i in ('where node') do set "NODE_PATH=%%i"

REM 创建命令目录
set "BIN_DIR=%USERPROFILE%\.openclaw\bin"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

REM 创建 openclaw.cmd
set "CMD_FILE=%BIN_DIR%\openclaw.cmd"
echo @echo off > "%CMD_FILE%"
echo "%NODE_PATH%" "%BUNDLE_DIR%\dist\entry.js" %%* >> "%CMD_FILE%"

echo [成功] 已创建 openclaw 命令
echo 位置: %CMD_FILE%
echo.
echo ========================================
echo   重要：添加到系统 PATH
echo ========================================
echo 请将以下目录添加到系统 PATH：
echo %BIN_DIR%
echo.
echo 添加方法：
echo 1. 按 Win+R，输入 sysdm.cpl
echo 2. 点击"高级" - "环境变量"
echo 3. 在"用户变量"中找到 Path，点击"编辑"
echo 4. 点击"新建"，粘贴上面的目录
echo 5. 确定保存，重启终端
echo.
pause
