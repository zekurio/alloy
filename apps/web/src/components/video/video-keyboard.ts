const KEYBOARD_SEEK_SECONDS = 5
export const KEYBOARD_LONG_SEEK_SECONDS = 10
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

export function shouldHandleVideoShortcut(
  target: EventTarget,
  currentTarget: HTMLDivElement,
): boolean {
  if (target === currentTarget) return true
  if (!(target instanceof HTMLElement)) return false
  if (target.closest("[data-video-shortcut-scope='ignore']")) return false
  if (target.isContentEditable) return false

  const tag = target.tagName
  if (
    tag === "BUTTON" ||
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA"
  ) {
    return false
  }

  const role = target.getAttribute("role")
  return role !== "slider" && role !== "button" && role !== "combobox"
}

export function shouldHandleGlobalVideoShortcut(
  target: EventTarget | null,
  playerRoot: HTMLElement | null,
) {
  if (!(target instanceof HTMLElement)) return true
  if (target.closest("[data-video-shortcut-scope='ignore']")) return false
  if (target.isContentEditable) return false

  const tag = target.tagName
  if (
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    tag === "A"
  ) {
    return false
  }

  const isPlayerControl = Boolean(
    playerRoot?.contains(target) ||
    target.closest("[data-video-player-control]"),
  )

  if (tag === "BUTTON" && !isPlayerControl) return false

  const role = target.getAttribute("role")
  if (role === "slider" || role === "combobox") return false
  return role !== "button" || isPlayerControl
}

export function handleVideoKeyCommand(
  e: KeyboardEvent,
  command: VideoKeyCommand,
  options: { enableHorizontalSeek?: boolean } = {},
): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false
  const key = e.key.toLowerCase()
  const enableHorizontalSeek = options.enableHorizontalSeek ?? true

  if (e.key === " " || e.code === "Space" || key === "k") {
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
