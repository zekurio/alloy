/** One clip or screenshot shortcut as the desktop bound it. */
export interface DesktopShortcut {
  /** `clip` or `screenshot`. */
  id: string
  /** The desktop's description of the keys; empty while none are assigned. */
  trigger: string
}

/**
 * The clip and screenshot shortcuts the desktop binds where the recorder has
 * no key hook (Linux, through the GlobalShortcuts portal). The desktop owns
 * the keys: the saved hotkeys only suggest them the first time.
 */
export interface DesktopShortcutsState {
  /** Whether this platform binds the shortcuts through the desktop. */
  supported: boolean
  /** Set while the desktop is asked, including while its dialog is open. */
  binding: boolean
  shortcuts: DesktopShortcut[]
  /** Whether the desktop can open its own settings for the shortcuts. */
  configurable: boolean
  /** A user-facing reason the shortcuts couldn't be set up. */
  error: string | null
}
