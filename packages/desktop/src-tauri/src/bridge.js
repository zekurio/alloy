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

  // The window is frameless. Honor the web app's `app-region` CSS the way a
  // native title bar would: the nearest ancestor that sets drag or no-drag
  // wins, a press on a drag region moves the window, and a double click
  // toggles maximize.
  function appRegion(target) {
    for (
      let node = target;
      node instanceof Element;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node)
      const region =
        style.getPropertyValue("app-region") ||
        style.getPropertyValue("-webkit-app-region")
      if (region === "drag" || region === "no-drag") return region
    }
    return "none"
  }
  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || appRegion(event.target) !== "drag") return
    event.preventDefault()
    if (event.detail >= 2) {
      void shell("toggleMaximizeWindow").catch(() => {})
    } else {
      void shell("startDragging").catch(() => {})
    }
  })

  window.alloyTauriDesktop = Object.freeze({
    bridgeContract: 1,
    minimizeWindow: () => shell("minimizeWindow"),
    toggleMaximizeWindow: () => shell("toggleMaximizeWindow"),
    closeWindow: () => shell("closeWindow"),
    openConnect: () => shell("openConnect"),
    openSettings: () => shell("openSettings"),
    openLogsFolder: () => shell("openLogsFolder"),
    reloadApp: () => shell("reloadApp"),
    servers: Object.freeze({
      switchTo: (url) => call("servers.switchTo", url),
      list: () => call("servers.list"),
      current: () => call("servers.current"),
      forget: (url) => call("servers.forget", url),
    }),
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
