/**
 * Native notification payload sent by the bundled app. This never goes through
 * the server; Electron validates it before showing an OS notification.
 */
export interface DesktopNotificationInput {
  title: string
  body: string
  targetPath: string
}

/** Desktop notification controls exposed to the bundled app. */
export interface AlloyDesktopNotificationsApi {
  show(input: DesktopNotificationInput): Promise<void>
}
