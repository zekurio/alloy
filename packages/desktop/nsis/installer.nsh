# Additions to electron-builder's NSIS installer.
#
# The login item is the `Alloy` value under the Run key. The Tauri host
# registered the same name, and `src/main/autostart.ts` manages it with
# `--autostart`; keep the three in step.

!define AUTOSTART_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
# Task Manager's per-entry enable/disable state for Run entries.
!define AUTOSTART_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define AUTOSTART_NAME "Alloy"
# The per-user install the Tauri host's NSIS bundle registered.
!define TAURI_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alloy"
!define TAURI_MAIN_BINARY "alloy-desktop.exe"
# electron-updater's download cache: `extraMetadata.name` in
# electron-builder.yml plus "-updater" (app-builder-lib appInfo).
!define UPDATER_CACHE_DIR "alloy-updater"

# Removes the Tauri build this install replaces. Its uninstaller runs in
# update mode, which keeps the login item and shortcuts for this install to
# take over, and silently, which never deletes the settings, saved servers,
# and capture library both builds share. It always drops its Apps & Features
# entry and its files.
!macro removeTauriInstall
  ReadRegStr $R0 HKCU "${TAURI_UNINSTALL_KEY}" "MainBinaryName"
  ReadRegStr $R1 HKCU "${TAURI_UNINSTALL_KEY}" "InstallLocation"
  # InstallLocation is written with quotes around it.
  StrCpy $R2 $R1 1
  ${if} $R2 == '"'
    StrCpy $R1 $R1 "" 1
    StrCpy $R1 $R1 -1
  ${endif}
  ${if} $R0 == "${TAURI_MAIN_BINARY}"
  ${andIf} $R1 != ""
  ${andIf} ${FileExists} "$R1\uninstall.exe"
    DetailPrint "Removing the previous Alloy build."
    # `_?=` runs the uninstaller in place, so this waits for it.
    ExecWait '"$R1\uninstall.exe" /S /UPDATE _?=$R1'
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
    DeleteRegKey HKCU "${TAURI_UNINSTALL_KEY}"
  ${endif}
!macroend

!macro customInstall
  !insertmacro removeTauriInstall
  # Point an existing login item, whether from an earlier install or from the
  # Tauri build, at this executable. The user's choice stays as it was.
  ReadRegStr $0 HKCU "${AUTOSTART_RUN_KEY}" "${AUTOSTART_NAME}"
  ${if} $0 != ""
    WriteRegStr HKCU "${AUTOSTART_RUN_KEY}" "${AUTOSTART_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
  ${endif}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "${AUTOSTART_RUN_KEY}" "${AUTOSTART_NAME}"
    DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "${AUTOSTART_NAME}"
    # Transient data outside the app data folders, which stay.
    RMDir /r "$LOCALAPPDATA\${UPDATER_CACHE_DIR}"
    RMDir /r "$TEMP\Alloy"
  ${endif}
!macroend
