# Autostart (login item) support for the assisted installer.
#
# The Run registry value name is ${APP_ID} and the command carries the
# --autostart flag; both must stay in sync with
# packages/desktop/src/main/autostart.ts, where the in-app settings toggle
# manages the same entry through app.setLoginItemSettings().

!include "nsDialogs.nsh"
!include "getProcessInfo.nsh"

!define AUTOSTART_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
# Task Manager's per-entry enable/disable state lives here; stale disable
# markers would keep a re-enabled entry dead, so it is cleared alongside.
!define AUTOSTART_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define RECORDER_EXECUTABLE_FILENAME "alloy-agent.exe"
# electron-updater's installer cache: sanitizeFileName(package name) +
# "-updater" (app-builder-lib appInfo.ts). Must follow a package rename.
!define UPDATER_CACHE_DIR "@alloydesktop-updater"

# Defining customCheckAppRunning suppresses electron-builder's process-info
# include and pid declaration, so provide both before delegating to its normal
# app shutdown flow.
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING

  # The Electron process can be gone while its child recorder is still
  # unloading OBS DLLs. Do not let install/uninstall touch resources until the
  # child has definitely exited. On PowerShell-capable systems
  # _CHECK_APP_RUNNING's install-dir-scoped scan above already covers the
  # recorder; this loop matters for the tasklist fallback, which filters by
  # image name (and by user on per-user installs), so another user's recorder
  # is never hit.
  StrCpy $R1 0
  recorderCheck:
    !insertmacro FIND_PROCESS "${RECORDER_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto recorderStopped
    ${endif}
    ${if} $R1 >= 3
      # Details panes are hidden in every install/uninstall mode, so a bare
      # Abort message would be swallowed; tell the user before bailing.
      MessageBox MB_OK|MB_ICONEXCLAMATION "Cannot stop ${RECORDER_EXECUTABLE_FILENAME}. Close it in Task Manager and try again." /SD IDOK
      Abort "Cannot stop ${RECORDER_EXECUTABLE_FILENAME}."
    ${endif}
    DetailPrint "Stopping ${RECORDER_EXECUTABLE_FILENAME}."
    !insertmacro KILL_PROCESS "${RECORDER_EXECUTABLE_FILENAME}" 1
    IntOp $R1 $R1 + 1
    Sleep 1000
    Goto recorderCheck
  recorderStopped:
!macroend

!macro customPageAfterChangeDir
  Var /GLOBAL autostartCheckbox
  Var /GLOBAL autostartEnabled

  Page custom autostartPageCreate autostartPageLeave

  Function autostartPageCreate
    ${if} ${isUpdated}
      Abort
    ${endif}

    !insertmacro MUI_HEADER_TEXT "Startup" "Choose how ${PRODUCT_NAME} starts."
    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endif}

    ${NSD_CreateCheckbox} 0 8u 100% 12u "&Start ${PRODUCT_NAME} when you sign in to Windows"
    Pop $autostartCheckbox
    ${NSD_SetState} $autostartCheckbox ${BST_CHECKED}
    ${NSD_CreateLabel} 0 26u 100% 20u "${PRODUCT_NAME} starts in the background so your games are captured right away. You can change this later in Settings."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function autostartPageLeave
    ${NSD_GetState} $autostartCheckbox $autostartEnabled
  FunctionEnd
!macroend

!macro customInit
  # Also covers silent fresh installs, where the checkbox page never shows:
  # autostart defaults to on (opt-out).
  StrCpy $autostartEnabled "1"
!macroend

!macro customInstall
  ${if} ${isUpdated}
    # Silent auto-update: never flip the user's choice, but refresh the
    # command in case the install location or launch arguments changed.
    ReadRegStr $0 HKCU "${AUTOSTART_RUN_KEY}" "${APP_ID}"
    ${if} $0 != ""
      WriteRegStr HKCU "${AUTOSTART_RUN_KEY}" "${APP_ID}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
    ${endif}
  ${elseif} $autostartEnabled == "1"
    WriteRegStr HKCU "${AUTOSTART_RUN_KEY}" "${APP_ID}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
    DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "${APP_ID}"
  ${else}
    DeleteRegValue HKCU "${AUTOSTART_RUN_KEY}" "${APP_ID}"
    DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "${APP_ID}"
  ${endif}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "${AUTOSTART_RUN_KEY}" "${APP_ID}"
    DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "${APP_ID}"

    # These leftovers live in the *user's* profile even on a per-machine
    # install, where SHELL_CONTEXT points $LOCALAPPDATA at ProgramData; flip
    # to the current user like electron-builder's own installer-store writes.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    # electron-updater's installer cache; electron-builder never cleans it.
    RMDir /r "$LOCALAPPDATA\${UPDATER_CACHE_DIR}"
    # Replay scratch and other transient temp state (recording-storage.ts).
    RMDir /r "$TEMP\Alloy"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endif}
!macroend
