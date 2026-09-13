;(() => {
  const selectedOrigin = "__ALLOY_SELECTED_ORIGIN__"
  if (window.top !== window || window.location.origin !== selectedOrigin) return

  const native = window.__TAURI_INTERNALS__
  const invoke = (command, args) =>
    native.invoke(command, args).catch((message) => {
      throw new Error(message)
    })
  const shell = (operation) => invoke("desktop_shell", { operation })
  const call = (operation, ...args) =>
    invoke("desktop_api", { operation, args })

  function subscribe(eventName, listener) {
    let disposed = false
    const callback = native.transformCallback((event) => {
      if (!disposed) listener(event.payload)
    })
    const registered = native.invoke("plugin:event|listen", {
      event: eventName,
      target: { kind: "Any" },
      handler: callback,
    })
    const releaseCallback = () => native.unregisterCallback(callback)
    void registered.catch(releaseCallback)
    const unlisten = async () => {
      const eventId = await registered
      window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(
        eventName,
        eventId,
      )
      await native.invoke("plugin:event|unlisten", {
        event: eventName,
        eventId,
      })
      native.unregisterCallback(callback)
    }
    return () => {
      if (disposed) return
      disposed = true
      void unlisten().catch(releaseCallback)
    }
  }

  const recording = {}
  for (const method of [
    "getSettings",
    "setSettings",
    "restartBackend",
    "getStatus",
    "getStorageInfo",
    "getLibrary",
    "revealLibraryCapture",
    "exportLibraryCapture",
    "updateLibraryCapture",
    "setLibraryCaptureTrim",
    "deleteLibraryCapture",
    "importLibraryFiles",
    "commitStagedLibraryImport",
    "discardStagedLibraryImport",
    "downloadClip",
    "cancelClipDownload",
    "listClipDownloads",
    "selectOutputFolder",
    "listGameProcesses",
    "listDisplays",
    "subscribeAudioLevels",
    "stopAudioLevels",
    "listNotificationSounds",
    "openNotificationSoundsFolder",
    "previewNotificationSound",
  ]) {
    recording[method] = (...args) => call(`recording.${method}`, ...args)
  }
  recording.saveLibraryCaptureThumbnail = (id, data) =>
    call("recording.saveLibraryCaptureThumbnail", id, Array.from(data))
  recording.onEvent = (listener) => subscribe("alloy:recording", listener)

  window.alloyTauriDesktop = Object.freeze({
    bridgeContract: 1,
    titlebarOverlay: false,
    minimizeWindow: () => shell("minimizeWindow"),
    toggleMaximizeWindow: () => shell("toggleMaximizeWindow"),
    closeWindow: () => shell("closeWindow"),
    openConnect: () => shell("openConnect"),
    openSettings: () => shell("openSettings"),
    reloadApp: () => shell("reloadApp"),
    recording: Object.freeze(recording),
    updates: Object.freeze({
      getState: () => call("updates.getState"),
      checkForUpdates: () => call("updates.checkForUpdates"),
      downloadUpdate: () => call("updates.downloadUpdate"),
      restartToInstall: () => call("updates.restartToInstall"),
      onState: (listener) => subscribe("alloy:updates", listener),
    }),
    autostart: Object.freeze({
      getState: () => call("autostart.getState"),
      setEnabled: (enabled) => call("autostart.setEnabled", enabled),
    }),
  })
})()
