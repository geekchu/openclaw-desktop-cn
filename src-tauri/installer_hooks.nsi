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

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillGatewayStatus
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillGatewayStatus
!macroend
