; Custom NSIS include for the Jetro assisted installer (electron-builder `nsis.include`).
;
; What this file does:
;   1. Welcome page (electron-builder omits MUI_PAGE_WELCOME by default).
;   2. Renames the uninstaller inside $INSTDIR to lowercase "uninstall.exe"
;      (electron-builder hardcodes "Uninstall <Product>.exe" in common.nsh
;      with no config option, so the define is overridden in customHeader,
;      which is expanded after common.nsh but before any use of the name).
;   3. Makes the uninstaller remove the whole install folder — including the
;      running uninstaller itself via async cleanup after exit.
;   4. Removes Jetro's auto-start login items. Electron's
;      setLoginItemSettings() writes HKCU\...\Run (+ the StartupApproved
;      shadow Task Manager reads); the app can never clean that on uninstall
;      because it isn't running. Without this every install/uninstall cycle
;      with "Launch at startup" on leaves a zombie Task Manager entry.

; Notes:
;   - Shortcuts follow the stock electron-builder behavior (Desktop + Start
;     Menu created per package.json; no finish-page options).
;   - The uninstall cleanup never touches user downloads or %APPDATA%
;     (deleteAppDataOnUninstall stays false).

!include "LogicLib.nsh"

; Per-build variable declarations (each build only declares what it uses).
!ifdef BUILD_UNINSTALLER
  Var JetroDidUninstall
!endif

; ---- 1. welcome page -------------------------------------------------------
!macro customWelcomePage
  !insertMacro MUI_PAGE_WELCOME
!macroend

; ---- 2. lowercase uninstaller filename --------------------------------------
!macro customHeader
  !ifdef UNINSTALL_FILENAME
    !undef UNINSTALL_FILENAME
  !endif
  !define UNINSTALL_FILENAME "uninstall.exe"
!macroend

; ---- 3. full install-folder removal on uninstall ------------------------------
; ---- 4. login-item cleanup (see header) ------------------------------------
!macro customUnInstall
  StrCpy $JetroDidUninstall "1"
  ; 4. Drop auto-start entries first so no zombie points at the folder we are
  ; about to delete. Canonical name is the AppUserModelId (com.jetrodl.app);
  ; "Jetro"/"jetro" cover installs from before the name was pinned. The
  ; StartupApproved values are Task Manager's enabled/disabled shadows —
  ; without deleting them the ghost row stays even after Run is gone.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.jetrodl.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Jetro"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "jetro"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.jetrodl.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Jetro"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "jetro"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "com.jetrodl.app"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Jetro"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "jetro"
  ; Startup-folder shortcut backstop (Electron uses the Run key, but a stray
  ; .lnk from a manual setup would launch a deleted exe the same way).
  Delete "$SMSTARTUP\Jetro.lnk"
  ; Backstop: remove anything the stock section left behind in $INSTDIR.
  RMDir /r "$INSTDIR"
  ; The running uninstaller locks its own exe, so retry the removal
  ; asynchronously after exit (covers silent uninstalls, which quit right
  ; away) and schedule reboot-removal as a last resort for locked files.
  ; The helper is started with a neutral working directory ($WINDIR): a
  ; process — including its console host — can never remove its own
  ; current directory, and it would otherwise inherit $INSTDIR from us.
  ExecShell "open" "$SYSDIR\cmd.exe" '/C start "JetroCleanup" /min /D "$WINDIR" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 5; Set-Location $\'$TEMP$\'; for ($$n=0; $$n -lt 60 -and (Test-Path -LiteralPath $\'$INSTDIR$\'); $$n++) { try { Remove-Item -LiteralPath $\'$INSTDIR$\' -Recurse -Force -ErrorAction Stop; break } catch { Start-Sleep -Seconds 2 } }"'
  Delete /REBOOTOK "$INSTDIR\${UNINSTALL_FILENAME}"
  RMDir /r /REBOOTOK "$INSTDIR"
!macroend

!ifdef BUILD_UNINSTALLER
Function un.onGUIEnd
  ; Same async self-cleanup for interactive uninstalls: by the time the
  ; retry loop gets the folder, this process has exited and released the
  ; lock on uninstall.exe. The flag guards cancelled uninstalls (the
  ; section — the only place setting it — never ran for those).
  ${If} $JetroDidUninstall == "1"
    ExecShell "open" "$SYSDIR\cmd.exe" '/C start "JetroCleanup" /min /D "$WINDIR" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 5; Set-Location $\'$TEMP$\'; for ($$n=0; $$n -lt 60 -and (Test-Path -LiteralPath $\'$EXEDIR$\'); $$n++) { try { Remove-Item -LiteralPath $\'$EXEDIR$\' -Recurse -Force -ErrorAction Stop; break } catch { Start-Sleep -Seconds 2 } }"'
    Delete /REBOOTOK "$EXEPATH"
    RMDir /r /REBOOTOK "$EXEDIR"
  ${EndIf}
FunctionEnd
!endif
