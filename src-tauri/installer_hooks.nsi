; Keep the finish-page "Run app" action checked by default.
; In basicUi updater mode this gives users a visible overwrite/install flow and
; then reopens the new version when they finish the installer.

Var LegacyInstallDir
Var LegacyMainBinary
Var LegacyRegistryHit
Var LegacyCleanupEligible
Var WaitPathTarget

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

  Sleep 250
FunctionEnd

Function WaitForPathToDisappear
  Push $0

  StrCpy $0 0

  wait_path_loop:
  ${IfNot} ${FileExists} "$WaitPathTarget"
    Goto wait_path_done
  ${EndIf}

  IntCmp $0 8 wait_path_done wait_path_sleep wait_path_done

  wait_path_sleep:
  Sleep 200
  IntOp $0 $0 + 1
  Goto wait_path_loop

  wait_path_done:
  Pop $0
FunctionEnd

Function AbortRuntimeCleanupFailure
  Exch $0
  DetailPrint $0

  IfSilent 0 +2
    Abort

  MessageBox MB_OK|MB_ICONSTOP "$0"
  Abort
FunctionEnd

Function CleanupCurrentInstallRuntime
  DetailPrint "Cleaning existing runtime bundle directories..."
  DetailPrint "Checking previous install file locks..."

  FileOpen $0 "$TEMP\openclaw-clean-runtime.ps1" w
  FileWrite $0 "param([string]$$InstallDir)$\r$\n"
  FileWrite $0 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $0 "if ([string]::IsNullOrWhiteSpace($$InstallDir)) { exit 0 }$\r$\n"
  FileWrite $0 "if (-not (Test-Path -LiteralPath $$InstallDir)) { exit 0 }$\r$\n"
  FileWrite $0 "$$timeoutSeconds = 8$\r$\n"
  FileWrite $0 "$$cleanupJob = Start-Job -ScriptBlock {$\r$\n"
  FileWrite $0 "  param([string]$$InstallDir, [string]$$MainBinaryName)$\r$\n"
  FileWrite $0 "  $$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $0 "  $$targets = @($\r$\n"
  FileWrite $0 "    (Join-Path $$InstallDir 'gateway-bundle'),$\r$\n"
  FileWrite $0 "    (Join-Path $$InstallDir 'node-runtime')$\r$\n"
  FileWrite $0 "  ) | Where-Object { Test-Path -LiteralPath $$_ }$\r$\n"
  FileWrite $0 "  $$needle = ([System.IO.Path]::GetFullPath($$InstallDir)).TrimEnd('\').ToLowerInvariant()$\r$\n"
  FileWrite $0 "  $$currentPid = $$PID$\r$\n"
  FileWrite $0 "  $$processes = @()$\r$\n"
  FileWrite $0 "  function Test-InstallDirPath([string]$$pathValue) {$\r$\n"
  FileWrite $0 "    if ([string]::IsNullOrWhiteSpace($$pathValue)) { return $$false }$\r$\n"
  FileWrite $0 "    $$candidate = $$pathValue.Trim()$\r$\n"
  FileWrite $0 "    if ([string]::IsNullOrWhiteSpace($$candidate)) { return $$false }$\r$\n"
  FileWrite $0 "    try {$\r$\n"
  FileWrite $0 "      $$normalized = ([System.IO.Path]::GetFullPath($$candidate)).TrimEnd('\').ToLowerInvariant()$\r$\n"
  FileWrite $0 "    } catch {$\r$\n"
  FileWrite $0 "      return $$false$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "    return $$normalized -eq $$needle -or $$normalized.StartsWith($$needle + '\')$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  function Test-FileUnlocked([string]$$pathValue) {$\r$\n"
  FileWrite $0 "    if ([string]::IsNullOrWhiteSpace($$pathValue) -or -not (Test-Path -LiteralPath $$pathValue)) { return $$true }$\r$\n"
  FileWrite $0 "    $$stream = $$null$\r$\n"
  FileWrite $0 "    try {$\r$\n"
  FileWrite $0 "      $$stream = [System.IO.File]::Open($$pathValue, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)$\r$\n"
  FileWrite $0 "      return $$true$\r$\n"
  FileWrite $0 "    } catch [System.IO.IOException] {$\r$\n"
  FileWrite $0 "      return $$false$\r$\n"
  FileWrite $0 "    } catch [System.UnauthorizedAccessException] {$\r$\n"
  FileWrite $0 "      return $$false$\r$\n"
  FileWrite $0 "    } catch {$\r$\n"
  FileWrite $0 "      return $$false$\r$\n"
  FileWrite $0 "    } finally {$\r$\n"
  FileWrite $0 "      if ($$stream) { $$stream.Dispose() }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  function Get-LockedChildPaths([string]$$root, [int]$$limit = 12) {$\r$\n"
  FileWrite $0 "    $$locked = New-Object 'System.Collections.Generic.List[string]'$\r$\n"
  FileWrite $0 "    foreach ($$file in @(Get-ChildItem -LiteralPath $$root -Recurse -File -Force -ErrorAction SilentlyContinue)) {$\r$\n"
  FileWrite $0 "      if (-not (Test-FileUnlocked $$file.FullName)) {$\r$\n"
  FileWrite $0 "        [void]$$locked.Add($$file.FullName)$\r$\n"
  FileWrite $0 "        if ($$locked.Count -ge $$limit) { break }$\r$\n"
  FileWrite $0 "      }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "    return @($$locked)$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  try {$\r$\n"
  FileWrite $0 "    $$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, Name, ExecutablePath, CommandLine)$\r$\n"
  FileWrite $0 "  } catch {$\r$\n"
  FileWrite $0 "    try {$\r$\n"
  FileWrite $0 "      $$processes = @(Get-WmiObject Win32_Process -ErrorAction Stop | Select-Object ProcessId, Name, ExecutablePath, CommandLine)$\r$\n"
  FileWrite $0 "    } catch {$\r$\n"
  FileWrite $0 "      $$processes = @()$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  $$killIds = New-Object 'System.Collections.Generic.HashSet[int]'$\r$\n"
  FileWrite $0 "  foreach ($$proc in $$processes) {$\r$\n"
  FileWrite $0 "    if ([int]$$proc.ProcessId -eq [int]$$currentPid) { continue }$\r$\n"
  FileWrite $0 "    $$exe = if ($$proc.ExecutablePath) { $$proc.ExecutablePath } else { '' }$\r$\n"
  FileWrite $0 "    if (Test-InstallDirPath $$exe) {$\r$\n"
  FileWrite $0 "      [void]$$killIds.Add([int]$$proc.ProcessId)$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  if ($$killIds.Count -gt 0) {$\r$\n"
  FileWrite $0 "    Stop-Process -Id (@($$killIds)) -Force -ErrorAction SilentlyContinue$\r$\n"
  FileWrite $0 "    Start-Sleep -Milliseconds 350$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  $$unlockTargets = New-Object 'System.Collections.Generic.List[string]'$\r$\n"
  FileWrite $0 "  foreach ($$candidate in @($\r$\n"
  FileWrite $0 "    (Join-Path $$InstallDir $$MainBinaryName),$\r$\n"
  FileWrite $0 "    (Join-Path $$InstallDir 'uninstall.exe'),$\r$\n"
  FileWrite $0 "    (Join-Path $$InstallDir 'node-runtime\node.exe')$\r$\n"
  FileWrite $0 "  )) {$\r$\n"
  FileWrite $0 "    if (Test-Path -LiteralPath $$candidate) { [void]$$unlockTargets.Add($$candidate) }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  $$rootBinaries = @(Get-ChildItem -LiteralPath $$InstallDir -File -Force -ErrorAction SilentlyContinue | Where-Object { $$_.Extension -in '.exe', '.dll' } | Select-Object -ExpandProperty FullName)$\r$\n"
  FileWrite $0 "  foreach ($$candidate in $$rootBinaries) {$\r$\n"
  FileWrite $0 "    if (-not [string]::IsNullOrWhiteSpace($$candidate)) { [void]$$unlockTargets.Add($$candidate) }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  $$stillLocked = @()$\r$\n"
  FileWrite $0 "  for ($$attempt = 0; $$attempt -lt 4; $$attempt++) {$\r$\n"
  FileWrite $0 "    $$stillLocked = @()$\r$\n"
  FileWrite $0 "    foreach ($$pathValue in @($$unlockTargets | Select-Object -Unique)) {$\r$\n"
  FileWrite $0 "      if (-not (Test-FileUnlocked $$pathValue)) { $$stillLocked += $$pathValue }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "    if ($$stillLocked.Count -eq 0) { break }$\r$\n"
  FileWrite $0 "    Start-Sleep -Milliseconds 200$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  if ($$stillLocked.Count -gt 0) {$\r$\n"
  FileWrite $0 "    throw ((@($$stillLocked) | Select-Object -First 12) -join [Environment]::NewLine)$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  $$failed = New-Object 'System.Collections.Generic.List[string]'$\r$\n"
  FileWrite $0 "  foreach ($$target in $$targets) {$\r$\n"
  FileWrite $0 "    $$removed = $$false$\r$\n"
  FileWrite $0 "    for ($$i = 0; $$i -lt 4 -and -not $$removed; $$i++) {$\r$\n"
  FileWrite $0 "      try {$\r$\n"
  FileWrite $0 "        Get-ChildItem -LiteralPath $$target -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {$\r$\n"
  FileWrite $0 "          try { $$_.Attributes = 'Normal' } catch {}$\r$\n"
  FileWrite $0 "        }$\r$\n"
  FileWrite $0 "        Remove-Item -LiteralPath $$target -Recurse -Force -ErrorAction Stop$\r$\n"
  FileWrite $0 "        $$removed = $$true$\r$\n"
  FileWrite $0 "      } catch {$\r$\n"
  FileWrite $0 "        $$lockedChildren = @(Get-LockedChildPaths $$target 12)$\r$\n"
  FileWrite $0 "        if ($$lockedChildren.Count -gt 0) {$\r$\n"
  FileWrite $0 "          Start-Sleep -Milliseconds (200 * ($$i + 1))$\r$\n"
  FileWrite $0 "        } else {$\r$\n"
  FileWrite $0 "          Start-Sleep -Milliseconds (125 * ($$i + 1))$\r$\n"
  FileWrite $0 "        }$\r$\n"
  FileWrite $0 "      }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "    if ((Test-Path -LiteralPath $$target) -and -not $$removed) {$\r$\n"
  FileWrite $0 "      $$lockedChildren = @(Get-LockedChildPaths $$target 12)$\r$\n"
  FileWrite $0 "      if ($$lockedChildren.Count -gt 0) {$\r$\n"
  FileWrite $0 "        foreach ($$lockedChild in $$lockedChildren) { [void]$$failed.Add($$lockedChild) }$\r$\n"
  FileWrite $0 "      } else {$\r$\n"
  FileWrite $0 "        [void]$$failed.Add($$target)$\r$\n"
  FileWrite $0 "      }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  if ($$failed.Count -gt 0) {$\r$\n"
  FileWrite $0 "    throw ((@($$failed) | Select-Object -First 12) -join [Environment]::NewLine)$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "} -ArgumentList $$InstallDir, '${MAINBINARYNAME}.exe'$\r$\n"
  FileWrite $0 "if (-not (Wait-Job -Job $$cleanupJob -Timeout $$timeoutSeconds)) {$\r$\n"
  FileWrite $0 "  try { Stop-Job -Job $$cleanupJob -ErrorAction SilentlyContinue } catch {}$\r$\n"
  FileWrite $0 "  try { Remove-Job -Job $$cleanupJob -Force -ErrorAction SilentlyContinue } catch {}$\r$\n"
  FileWrite $0 "  [Console]::Error.WriteLine('cleanup timed out')$\r$\n"
  FileWrite $0 "  exit 124$\r$\n"
  FileWrite $0 "} $\r$\n"
  FileWrite $0 "$$cleanupErrors = @()$\r$\n"
  FileWrite $0 "Receive-Job -Job $$cleanupJob -ErrorVariable cleanupErrors -ErrorAction SilentlyContinue | Out-Null$\r$\n"
  FileWrite $0 "$$cleanupFailed = ($$cleanupJob.State -ne 'Completed') -or ($$cleanupErrors.Count -gt 0)$\r$\n"
  FileWrite $0 "if ($$cleanupFailed) {$\r$\n"
  FileWrite $0 "  if ($$cleanupErrors.Count -gt 0) {$\r$\n"
  FileWrite $0 "    foreach ($$cleanupError in $$cleanupErrors) {$\r$\n"
  FileWrite $0 "      if ($$cleanupError.Exception -and -not [string]::IsNullOrWhiteSpace($$cleanupError.Exception.Message)) {$\r$\n"
  FileWrite $0 "        [Console]::Error.WriteLine($$cleanupError.Exception.Message)$\r$\n"
  FileWrite $0 "      } else {$\r$\n"
  FileWrite $0 "        [Console]::Error.WriteLine($$cleanupError.ToString())$\r$\n"
  FileWrite $0 "      }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "  } elseif ($$cleanupJob.ChildJobs.Count -gt 0 -and $$cleanupJob.ChildJobs[0].JobStateInfo.Reason) {$\r$\n"
  FileWrite $0 "    [Console]::Error.WriteLine($$cleanupJob.ChildJobs[0].JobStateInfo.Reason.ToString())$\r$\n"
  FileWrite $0 "  } else {$\r$\n"
  FileWrite $0 "    [Console]::Error.WriteLine('cleanup failed')$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  try { Remove-Job -Job $$cleanupJob -Force -ErrorAction SilentlyContinue } catch {}$\r$\n"
  FileWrite $0 "  exit 1$\r$\n"
  FileWrite $0 "} $\r$\n"
  FileWrite $0 "try { Remove-Job -Job $$cleanupJob -Force -ErrorAction SilentlyContinue } catch {}$\r$\n"
  FileWrite $0 "exit 0$\r$\n"
  FileClose $0

  ClearErrors
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$TEMP\openclaw-clean-runtime.ps1" "$INSTDIR"'
  Pop $1
  Delete "$TEMP\openclaw-clean-runtime.ps1"

  ${If} $1 == "error"
    Push "安装前清理旧版本运行时目录失败。请完全退出 OpenClaw 和相关 node 进程后重试。"
    Call AbortRuntimeCleanupFailure
  ${ElseIf} $1 == "timeout"
    Push "安装前清理旧版本运行时目录超时。请完全退出 OpenClaw 后重试。"
    Call AbortRuntimeCleanupFailure
  ${ElseIf} $1 == 124
    Push "安装前清理旧版本运行时目录超时。请完全退出 OpenClaw 后重试。"
    Call AbortRuntimeCleanupFailure
  ${ElseIf} $1 != 0
    Push "旧版本文件仍在释放中，无法安全覆盖安装。请完全退出 OpenClaw 后重试。"
    Call AbortRuntimeCleanupFailure
  ${EndIf}
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
  ; Windows often returns from taskkill before the file handles are fully released.
  ; Give the previous process tree a short grace window before overwrite starts.
  Sleep 300
!macroend

!macro CleanupOldVersion
  ; 完整清理旧版本 (OpenClaw桌面版)
  ; 优先从注册表读取真实安装路径，并兼容旧版本写入的带引号 InstallLocation
  Call ResolveLegacyInstallState

  ${If} $LegacyCleanupEligible == "1"
    ; Tauri updater 的 /UPDATE 流程已经明确选择“就地覆盖当前安装”。
    ; 这里如果解析出的所谓“旧版本”目录其实就是当前 $INSTDIR，
    ; 再去跑静默卸载/整目录删除会和 updater 本身的覆盖安装打架，
    ; 表现上容易变成“应用重启了，但版本没有真正替换”。
    ClearErrors
    ${GetOptions} $CMDLINE "/UPDATE" $0
    ${IfNot} ${Errors}
      Push $LegacyInstallDir
      Call NormalizeLegacyPath
      Pop $1

      Push $INSTDIR
      Call NormalizeLegacyPath
      Pop $2

      ${StrCase} $1 $1 "L"
      ${StrCase} $2 $2 "L"
      ${If} $1 == $2
        DetailPrint "Updater mode detected; legacy cleanup target matches current install. Skipping legacy uninstall."
        Goto cleanup_done
      ${EndIf}
    ${EndIf}

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
      StrCpy $WaitPathTarget "$LegacyInstallDir"
      Call WaitForPathToDisappear

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
    StrCpy $WaitPathTarget "$LegacyInstallDir"
    Call WaitForPathToDisappear

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

  ; 覆盖安装第一次失败、第二次成功，说明第一次只是把旧进程/句柄打散了，
  ; 真正的 runtime 目录并没有在覆盖前清干净。对所有安装路径都执行预清理，
  ; 避免 updater/passive 流程把 gateway-bundle 残留锁带进文件复制阶段。
  Call CleanupCurrentInstallRuntime

  ; 3. 清理旧版本的 gateway-bundle 目录，防止残留文件导致插件加载警告
  RMDir /r "$INSTDIR\gateway-bundle"
  RMDir /r "$INSTDIR\node-runtime"

  ; 4. 自动清理旧版本 (OpenClaw桌面版) - 不询问用户，避免端口冲突
  !insertmacro CleanupOldVersion
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillGatewayStatus
!macroend
