import * as React from "react"

const KEYBOARD_SEEK_MS = 100
const KEYBOARD_LONG_SEEK_MS = 1000

/** Everything the editor's global keyboard shortcuts can trigger. */
export interface EditorKeyActions {
  togglePlayback: () => void
  splitAtPlayhead: () => void
  deleteSelected: () => void
  saveDraft: () => Promise<void>
  seekByKeyboard: (deltaMs: number) => void
  seekToStart: () => void
  seekToTimelineEnd: () => void
  zoomIn: () => void
  zoomOut: () => void
  undo: () => void
  redo: () => void
}

/**
 * Window-level keyboard shortcuts for the editor page. The actions object
 * is rebuilt every render (it closes over fresh state); the listener reads
 * it through a ref so the subscription itself attaches once.
 */
export function useEditorShortcuts(actions: EditorKeyActions): void {
  const keyActionsRef = React.useRef(actions)
  keyActionsRef.current = actions

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event)) return
      const action = shortcutAction(event, keyActionsRef.current)
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return Boolean(
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable ||
      target.closest('[role="dialog"]')),
  )
}

function shortcutAction(
  event: KeyboardEvent,
  actions: EditorKeyActions,
): (() => void) | null {
  if (event.key === " ") return actions.togglePlayback
  if (event.key === "Delete" || event.key === "Backspace") {
    return actions.deleteSelected
  }
  if (event.ctrlKey || event.metaKey) return modifierShortcut(event, actions)
  if (event.altKey) return null
  return plainShortcut(event, actions)
}

/** Ctrl/Cmd combos: undo/redo, save, zoom. */
function modifierShortcut(
  event: KeyboardEvent,
  actions: EditorKeyActions,
): (() => void) | null {
  switch (event.key.toLowerCase()) {
    case "z":
      return event.shiftKey ? actions.redo : actions.undo
    case "y":
      return actions.redo
    case "s":
      return () => void actions.saveDraft()
    case "=":
    case "+":
      return actions.zoomIn
    case "-":
      return actions.zoomOut
    default:
      return null
  }
}

/** Unmodified keys (shift allowed): seeking and split. */
function plainShortcut(
  event: KeyboardEvent,
  actions: EditorKeyActions,
): (() => void) | null {
  const seekMs = event.shiftKey ? KEYBOARD_LONG_SEEK_MS : KEYBOARD_SEEK_MS
  switch (event.key) {
    case "ArrowLeft":
      return () => actions.seekByKeyboard(-seekMs)
    case "ArrowRight":
      return () => actions.seekByKeyboard(seekMs)
    case "Home":
      return actions.seekToStart
    case "End":
      return actions.seekToTimelineEnd
  }
  if (event.key.toLowerCase() === "s") return actions.splitAtPlayhead
  return null
}
