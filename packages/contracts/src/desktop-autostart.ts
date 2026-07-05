/**
 * Login-item (autostart) state the desktop shell exposes to the web app over
 * the desktop bridge. This never goes through the server — autostart is
 * specific to the machine running the desktop app.
 */
export interface DesktopAutostartState {
  /**
   * Whether this build can register itself as a login item. False in
   * unpackaged dev builds and on platforms without login-item support.
   */
  supported: boolean
  /** Whether the app is currently registered to start when the user signs in. */
  enabled: boolean
}

/** Desktop autostart state and controls bridged into the web app. */
export interface AlloyDesktopAutostartApi {
  getState(): Promise<DesktopAutostartState>
  setEnabled(enabled: boolean): Promise<DesktopAutostartState>
}
