const KEYBOARD_SEEK_SECONDS = 5
const KEYBOARD_LONG_SEEK_SECONDS = 10
const KEYBOARD_VOLUME_STEP = 0.1

export type VideoKeyCommand = {
  togglePlay: () => void
  toggleMute: () => void
  seekBy: (delta: number) => void
  seekTo: (seconds: number) => void
  seekPercent: (percent: number) => void
  volumeBy: (delta: number) => void
  toggleFullscreen: () => void
}

/** Text fields, sliders and comboboxes handle their own keys, arrows included. */
export function ownsKeyboardInput(target: HTMLElement): boolean {
  if (target.closest("[data-video-shortcut-scope='ignore']")) return true
  if (target.isContentEditable) return true

  const tag = target.tagName
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return true

  const role = target.getAttribute("role")
  return role === "slider" || role === "combobox"
}

export function shouldHandleVideoShortcut(
  target: EventTarget,
  currentTarget: HTMLDivElement,
): boolean {
  if (target === currentTarget) return true
  if (!(target instanceof HTMLElement)) return false
  if (ownsKeyboardInput(target)) return false
  return target.tagName !== "BUTTON" && target.getAttribute("role") !== "button"
}

function isSpaceKey(e: KeyboardEvent): boolean {
  return e.key === " " || e.code === "Space"
}

export function shouldHandleGlobalVideoShortcut(
  e: KeyboardEvent,
  playerRoot: HTMLElement | null,
) {
  const target = e.target
  if (!(target instanceof HTMLElement)) return true
  if (ownsKeyboardInput(target) || target.tagName === "A") return false

  const isPlayerControl = Boolean(
    playerRoot?.contains(target) ||
    target.closest("[data-video-player-control]"),
  )

  if (target.tagName !== "BUTTON" && target.getAttribute("role") !== "button")
    return true

  // Space activates a button reached with the keyboard, the player's own Mute
  // or Fullscreen included. A button that only holds focus from a mouse click
  // shows no focus ring, so Space still toggles playback there, and letter
  // shortcuts such as K reach the player either way.
  if (isSpaceKey(e) && target.matches(":focus-visible")) return false
  return isPlayerControl
}

export function handleVideoKeyCommand(
  e: KeyboardEvent,
  command: VideoKeyCommand,
  options: { enableHorizontalSeek?: boolean } = {},
): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false
  const key = e.key.toLowerCase()
  const enableHorizontalSeek = options.enableHorizontalSeek ?? true

  if (isSpaceKey(e) || key === "k") {
    e.preventDefault()
    command.togglePlay()
    return true
  }
  if (enableHorizontalSeek && e.key === "ArrowLeft") {
    e.preventDefault()
    command.seekBy(-KEYBOARD_SEEK_SECONDS)
    return true
  }
  if (enableHorizontalSeek && e.key === "ArrowRight") {
    e.preventDefault()
    command.seekBy(KEYBOARD_SEEK_SECONDS)
    return true
  }
  if (key === "j") {
    e.preventDefault()
    command.seekBy(-KEYBOARD_LONG_SEEK_SECONDS)
    return true
  }
  if (key === "l") {
    e.preventDefault()
    command.seekBy(KEYBOARD_LONG_SEEK_SECONDS)
    return true
  }
  if (e.key === "ArrowUp") {
    e.preventDefault()
    command.volumeBy(KEYBOARD_VOLUME_STEP)
    return true
  }
  if (e.key === "ArrowDown") {
    e.preventDefault()
    command.volumeBy(-KEYBOARD_VOLUME_STEP)
    return true
  }
  if (e.key === "Home") {
    e.preventDefault()
    command.seekTo(0)
    return true
  }
  if (e.key === "End") {
    e.preventDefault()
    command.seekTo(Number.POSITIVE_INFINITY)
    return true
  }
  if (/^[0-9]$/.test(key)) {
    e.preventDefault()
    command.seekPercent(Number(key) / 10)
    return true
  }
  if (key === "m") {
    e.preventDefault()
    command.toggleMute()
    return true
  }
  if (key === "f") {
    e.preventDefault()
    command.toggleFullscreen()
    return true
  }

  return false
}
