; Tauri's NSIS template auto-checks the "Run app" checkbox on the finish page.
; Leave it unchecked so install completion does not immediately launch the app
; and start background processes while the installer is still exiting.
!define MUI_FINISHPAGE_RUN_NOTCHECKED

Var LegacyInstallDir
Var LegacyMainBinary
Var LegacyRegistryHit
Var LegacyCleanupEligible

Function NormalizeLegacyPath
  Exch $0

  StrCpy $1 $0 1
  ${If} $1 == '"'
    StrCpy $0 $0 "" 1
  ${EndIf}

  StrLen $1 $0
  ${If} $1 > 0
    IntOp $1 $1 - 1
    StrCpy $2 $0 1 $1
    ${If} $2 == '"'
      StrCpy $0 $0 $1
    ${EndIf}
  ${EndIf}

  StrLen $1 $0
  ${If} $1 > 0
    IntOp $1 $1 - 1
    StrCpy $2 $0 1 $1
    ${If} $2 == "\"
      StrCpy $0 $0 $1
    ${EndIf}
  ${EndIf}

  Exch $0
FunctionEnd

Function GetPathSuffixForLegacyCheck
  Exch $0

  ${If} $0 == ""
    Goto path_suffix_done
  ${EndIf}

  StrCpy $1 "$LOCALAPPDATA\"
  StrLen $2 $1
  StrCpy $3 $0 $2
  ${StrCase} $4 $1 "L"
  ${StrCase} $5 $3 "L"
  ${If} $5 == $4
    StrCpy $0 $0 "" $2
    Goto path_suffix_done
  ${EndIf}

  StrCpy $1 "$LOCALAPPDATA"
  ${StrCase} $4 $1 "L"
  ${StrCase} $5 $0 "L"
  ${If} $5 == $4
    StrCpy $0 ""
  ${EndIf}

  path_suffix_done:
  Exch $0
FunctionEnd

Function PathContainsNonAscii
  Exch $0
  StrCpy $1 ""

  ${If} $0 == ""
    Goto path_contains_non_ascii_done
  ${EndIf}

  Push $0
  Call GetPathSuffixForLegacyCheck
  Pop $0

  StrCpy $2 "$TEMP\openclaw-path-has-nonascii.ps1"
  FileOpen $3 "$2" w
  FileWrite $3 "param([string]$$PathValue)$\r$\n"
  FileWrite $3 "if ([string]::IsNullOrEmpty($$PathValue)) { exit 1 }$\r$\n"
  FileWrite $3 "foreach ($$ch in $$PathValue.ToCharArray()) {$\r$\n"
  FileWrite $3 "  if ([int][char]$$ch -gt 127) { exit 0 }$\r$\n"
  FileWrite $3 "}$\r$\n"
  FileWrite $3 "exit 1$\r$\n"
  FileClose $3

  ClearErrors
  ; Use nsExec so the legacy-path probe does not flash a PowerShell console window.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$2" "$0"'
  Pop $1
  Delete "$2"

  ${If} $1 == "error"
    StrCpy $0 ""
  ${ElseIf} $1 == "timeout"
    StrCpy $0 ""
  ${ElseIf} $1 == 0
    StrCpy $0 "1"
  ${Else}
    StrCpy $0 ""
  ${EndIf}

  path_contains_non_ascii_done:
  Exch $0
FunctionEnd

Function ResolveLegacyInstallState
  StrCpy $LegacyInstallDir ""
  StrCpy $LegacyMainBinary ""
  StrCpy $LegacyRegistryHit ""
  StrCpy $LegacyCleanupEligible ""

  ${If} ${RunningX64}
    SetRegView 64

    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "InstallLocation"
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "MainBinaryName"
    ${If} $0 != ""
      StrCpy $LegacyInstallDir $0
      StrCpy $LegacyRegistryHit "1"
      ${If} $1 != ""
        StrCpy $LegacyMainBinary $1
      ${EndIf}
      Goto legacy_resolve_done
    ${EndIf}

    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "InstallLocation"
    ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "MainBinaryName"
    ${If} $0 != ""
      StrCpy $LegacyInstallDir $0
      StrCpy $LegacyRegistryHit "1"
      ${If} $1 != ""
        StrCpy $LegacyMainBinary $1
      ${EndIf}
      Goto legacy_resolve_done
    ${EndIf}

    ReadRegStr $0 HKCU "Software\openclaw\OpenClaw桌面版" ""
    ${If} $0 != ""
      StrCpy $LegacyInstallDir $0
      StrCpy $LegacyRegistryHit "1"
      Goto legacy_resolve_done
    ${EndIf}

    ReadRegStr $0 HKLM "Software\openclaw\OpenClaw桌面版" ""
    ${If} $0 != ""
      StrCpy $LegacyInstallDir $0
      StrCpy $LegacyRegistryHit "1"
      Goto legacy_resolve_done
    ${EndIf}
  ${EndIf}

  SetRegView 32

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "InstallLocation"
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "MainBinaryName"
  ${If} $0 != ""
    StrCpy $LegacyInstallDir $0
    StrCpy $LegacyRegistryHit "1"
    ${If} $1 != ""
      StrCpy $LegacyMainBinary $1
    ${EndIf}
    Goto legacy_resolve_done
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "InstallLocation"
  ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版" "MainBinaryName"
  ${If} $0 != ""
    StrCpy $LegacyInstallDir $0
    StrCpy $LegacyRegistryHit "1"
    ${If} $1 != ""
      StrCpy $LegacyMainBinary $1
    ${EndIf}
    Goto legacy_resolve_done
  ${EndIf}

  ReadRegStr $0 HKCU "Software\openclaw\OpenClaw桌面版" ""
  ${If} $0 != ""
    StrCpy $LegacyInstallDir $0
    StrCpy $LegacyRegistryHit "1"
    Goto legacy_resolve_done
  ${EndIf}

  ReadRegStr $0 HKLM "Software\openclaw\OpenClaw桌面版" ""
  ${If} $0 != ""
    StrCpy $LegacyInstallDir $0
    StrCpy $LegacyRegistryHit "1"
    Goto legacy_resolve_done
  ${EndIf}

  legacy_resolve_done:
  Push $LegacyInstallDir
  Call NormalizeLegacyPath
  Pop $LegacyInstallDir

  Push $LegacyMainBinary
  Call NormalizeLegacyPath
  Pop $LegacyMainBinary

  Push $LegacyInstallDir
  Call PathContainsNonAscii
  Pop $0

  ${If} $LegacyInstallDir == ""
    StrCpy $LegacyCleanupEligible ""
  ${ElseIf} $LegacyInstallDir == "$LOCALAPPDATA\OpenClaw桌面版"
  ${AndIf} ${FileExists} "$LegacyInstallDir"
    StrCpy $LegacyCleanupEligible "1"
  ${ElseIf} $LegacyMainBinary == "OpenClaw桌面版.exe"
  ${AndIf} ${FileExists} "$LegacyInstallDir\OpenClaw桌面版.exe"
    StrCpy $LegacyCleanupEligible "1"
  ${ElseIf} $LegacyMainBinary != ""
  ${AndIf} ${FileExists} "$LegacyInstallDir\$LegacyMainBinary"
    StrCpy $LegacyCleanupEligible "1"
  ${ElseIf} ${FileExists} "$LegacyInstallDir\OpenClaw桌面版.exe"
    StrCpy $LegacyCleanupEligible "1"
  ${ElseIf} $0 == "1"
  ${AndIf} ${FileExists} "$LegacyInstallDir\uninstall.exe"
    ; Non-ASCII paths still count as legacy installs, but only when the old
    ; installer left a recognizable uninstaller behind.
    StrCpy $LegacyCleanupEligible "1"
  ${EndIf}

  ${If} $LegacyCleanupEligible != "1"
  ${AndIf} $LegacyInstallDir == ""
  ${AndIf} $LegacyMainBinary == "OpenClaw桌面版.exe"
    StrCpy $LegacyInstallDir "$LOCALAPPDATA\OpenClaw桌面版"
    Push $LegacyInstallDir
    Call NormalizeLegacyPath
    Pop $LegacyInstallDir

    ${If} ${FileExists} "$LegacyInstallDir"
    ${OrIf} ${FileExists} "$LegacyInstallDir\OpenClaw桌面版.exe"
    ${OrIf} ${FileExists} "$LegacyInstallDir\uninstall.exe"
      StrCpy $LegacyCleanupEligible "1"
    ${Else}
      StrCpy $LegacyInstallDir ""
    ${EndIf}
  ${EndIf}

  ${If} $LegacyCleanupEligible != "1"
  ${AndIf} $LegacyRegistryHit == ""
    StrCpy $LegacyInstallDir "$LOCALAPPDATA\OpenClaw桌面版"
    Push $LegacyInstallDir
    Call NormalizeLegacyPath
    Pop $LegacyInstallDir

    ${If} ${FileExists} "$LegacyInstallDir"
    ${OrIf} ${FileExists} "$LegacyInstallDir\OpenClaw桌面版.exe"
      StrCpy $LegacyCleanupEligible "1"
      StrCpy $LegacyMainBinary "OpenClaw桌面版.exe"
    ${EndIf}
  ${EndIf}

  ${If} $LegacyCleanupEligible == "1"
  ${AndIf} $LegacyMainBinary == ""
    StrCpy $LegacyMainBinary "OpenClaw桌面版.exe"
  ${EndIf}

  ${If} ${RunningX64}
    SetRegView 64
  ${Else}
    SetRegView 32
  ${EndIf}
FunctionEnd

Function UsePreferredInstallDir
  Push $INSTDIR
  Call PathContainsNonAscii
  Pop $0

  ${If} $INSTDIR == "$LOCALAPPDATA\OpenClaw桌面版"
  ${OrIf} $0 == "1"
    StrCpy $INSTDIR "$LOCALAPPDATA\OpenClaw Desktop"
    DetailPrint "Using English install path: $INSTDIR"
  ${EndIf}

  SetOutPath $INSTDIR
FunctionEnd

Function StopLegacyProcesses
  DetailPrint "Stopping old version processes..."

  ${If} $LegacyMainBinary != ""
    nsExec::ExecToLog 'taskkill /F /IM "$LegacyMainBinary" /T'
  ${EndIf}
  ${If} $LegacyMainBinary != "OpenClaw桌面版.exe"
    nsExec::ExecToLog 'taskkill /F /IM "OpenClaw桌面版.exe" /T'
  ${EndIf}
  ${If} $LegacyMainBinary != "openclaw-desktop.exe"
    nsExec::ExecToLog 'taskkill /F /IM "openclaw-desktop.exe" /T'
  ${EndIf}

  Sleep 1000
FunctionEnd

!macro KillGatewayStatus
  ; 1. 强杀客户端主进程，防止主进程的健康检查在我们杀掉 Gateway 后又将其复活
  nsExec::ExecToLog 'taskkill /F /IM $\"${MAINBINARYNAME}.exe$\" /T'
  
  ; 2. 写入临时 bat 脚本，通过端口号强杀依然占据 28789 的 Gateway / Node 进程，确保释放文件锁。
  FileOpen $0 "$TEMP\kill_gateway.bat" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "for /f $\"tokens=5$\" %%a in ('netstat -a -n -o ^| findstr :28789') do taskkill /F /T /PID %%a$\r$\n"
  FileClose $0
  nsExec::ExecToLog '"$TEMP\kill_gateway.bat"'
  Delete "$TEMP\kill_gateway.bat"
!macroend

!macro CleanupOldVersion
  ; 完整清理旧版本 (OpenClaw桌面版)
  ; 优先从注册表读取真实安装路径，并兼容旧版本写入的带引号 InstallLocation
  Call ResolveLegacyInstallState

  ${If} $LegacyCleanupEligible == "1"
    DetailPrint "Detected old version at: $LegacyInstallDir"
    DetailPrint "Legacy main binary: $LegacyMainBinary"

    ; 1.1 先停止旧版本进程，避免卸载器因为文件占用失败
    Call StopLegacyProcesses

    ; 1. 尝试调用旧版本的卸载程序（最干净的方式）
    StrCpy $2 "$LegacyInstallDir\uninstall.exe"
    ${If} ${FileExists} "$2"
      DetailPrint "Running old version uninstaller..."

      ; 调用卸载程序并等待完成（不使用 _?= 参数，让卸载程序正常删除目录）
      ExecWait '"$2" /S' $0
      Sleep 2000  ; 额外等待，确保文件系统更新完成

      DetailPrint "Uninstaller exit code: $0"

      ; 检查卸载是否成功
      ${If} ${FileExists} "$LegacyInstallDir"
        DetailPrint "WARNING: Uninstaller completed, but directory still exists."
        DetailPrint "This may indicate files in use or uninstaller failure."
        DetailPrint "Proceeding with manual cleanup..."
      ${Else}
        DetailPrint "Old version uninstalled successfully via uninstaller."
        DetailPrint "Old version (OpenClaw桌面版) has been uninstalled. User data in %USERPROFILE%\\.openclawcn\\ has been preserved."
        Goto cleanup_done
      ${EndIf}
    ${Else}
      DetailPrint "Old version uninstaller not found at: $2"
      DetailPrint "Proceeding with manual cleanup..."
    ${EndIf}

    ; 2. 手动清理（如果卸载程序不存在或失败）
    DetailPrint "Performing manual cleanup of old version..."

    ; 2.1 停止旧版本进程
    Call StopLegacyProcesses

    ; 2.2 删除开始菜单快捷方式
    DetailPrint "Removing Start Menu shortcuts..."
    Delete "$SMPROGRAMS\OpenClaw桌面版.lnk"
    Delete "$SMPROGRAMS\OpenClaw桌面版\*.lnk"
    RMDir "$SMPROGRAMS\OpenClaw桌面版"

    ; 2.3 删除桌面快捷方式
    DetailPrint "Removing Desktop shortcuts..."
    Delete "$DESKTOP\OpenClaw桌面版.lnk"

    ; 2.4 删除自动启动项
    DetailPrint "Removing autostart entries..."
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "OpenClaw桌面版"
    Delete "$SMSTARTUP\OpenClaw桌面版.lnk"

    ; 2.5 删除注册表卸载信息
    DetailPrint "Removing registry uninstall entries..."
    ${If} ${RunningX64}
      SetRegView 64
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版"
      DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版"
      DeleteRegKey HKCU "Software\openclaw\OpenClaw桌面版"
      DeleteRegKey HKLM "Software\openclaw\OpenClaw桌面版"
    ${EndIf}

    SetRegView 32
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenClaw桌面版"
    DeleteRegKey HKCU "Software\openclaw\OpenClaw桌面版"
    DeleteRegKey HKLM "Software\openclaw\OpenClaw桌面版"

    ${If} ${RunningX64}
      SetRegView 64
    ${Else}
      SetRegView 32
    ${EndIf}

    ; 2.7 删除安装目录
    DetailPrint "Removing installation directory..."
    RMDir /r "$LegacyInstallDir"
    Sleep 500

    ; 2.8 检查清理结果
    ${If} ${FileExists} "$LegacyInstallDir"
      DetailPrint "WARNING: Failed to remove old version directory completely."
      DetailPrint "WARNING: Some legacy files may still be in use."
      DetailPrint "WARNING: Please manually delete: $LegacyInstallDir"
      DetailPrint "WARNING: Old and new versions may conflict (port 28789)."
    ${Else}
      DetailPrint "Old version cleaned up successfully."
      DetailPrint "Old version removed successfully. User data in %USERPROFILE%\\.openclawcn\\ has been preserved."
    ${EndIf}

    cleanup_done:
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; 保持产品显示名不变，仅将默认安装目录切换为英文路径。
  Call UsePreferredInstallDir

  !insertmacro KillGatewayStatus

  ; 3. 清理旧版本的 gateway-bundle 目录，防止残留文件导致插件加载警告
  RMDir /r "$INSTDIR\gateway-bundle"

  ; 4. 自动清理旧版本 (OpenClaw桌面版) - 不询问用户，避免端口冲突
  !insertmacro CleanupOldVersion
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillGatewayStatus
!macroend
