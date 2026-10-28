# Additions to electron-builder's NSIS installer.
#
# The login item is the `Alloy` value under the Run key, which
# `src/main/autostart.ts` manages with `--autostart`; keep the two in step.

!define AUTOSTART_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
# Task Manager's per-entry enable/disable state for Run entries.
!define AUTOSTART_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define AUTOSTART_NAME "Alloy"
# electron-updater's download cache: `extraMetadata.name` in
# electron-builder.yml plus "-updater" (app-builder-lib appInfo).
!define UPDATER_CACHE_DIR "alloy-updater"

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "${AUTOSTART_RUN_KEY}" "${AUTOSTART_NAME}"
    DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "${AUTOSTART_NAME}"
    RMDir /r "$LOCALAPPDATA\${UPDATER_CACHE_DIR}"
    RMDir /r "$TEMP\Alloy"
    # The local folder named after `appId` (`resolveFolders` in
    # `src/main/paths.ts`): caches, logs, and Chromium's profile, which holds
    # each server's `alloy_session` cookie. Settings, saved servers and the
    # capture manifest in the roaming folder stay, and so do recordings. An
    # update or a reinstall runs this uninstaller with `--updated`, which
    # keeps all of it.
    RMDir /r "$LOCALAPPDATA\${APP_ID}"
  ${endif}
!macroend
