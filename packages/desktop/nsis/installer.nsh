# Autostart (login item) support for the assisted installer.
#
# The Run registry value name is ${APP_ID} and the command carries the
# --autostart flag; both must stay in sync with
# packages/desktop/src/main/autostart.ts, where the in-app settings toggle
# manages the same entry through app.setLoginItemSettings().

!include "nsDialogs.nsh"

!define AUTOSTART_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
# Task Manager's per-entry enable/disable state lives here; stale disable
# markers would keep a re-enabled entry dead, so it is cleared alongside.
!define AUTOSTART_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

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
  ${endif}
!macroend
