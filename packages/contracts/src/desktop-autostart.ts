/**
 * Login-item state exposed to the bundled app through its native API. This
 * never goes through the server because autostart belongs to this machine.
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

/** Desktop autostart state and controls exposed to the bundled app. */
export interface AlloyDesktopAutostartApi {
  getState(): Promise<DesktopAutostartState>
  setEnabled(enabled: boolean): Promise<DesktopAutostartState>
}
