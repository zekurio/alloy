/**
 * Native notification payload sent by the desktop web app. This never goes through
 * the server; Electron validates it before showing an OS notification.
 */
export interface DesktopNotificationInput {
  title: string
  body: string
  targetPath: string
}

/** Desktop notification controls exposed through the native bridge. */
export interface AlloyDesktopNotificationsApi {
  show(input: DesktopNotificationInput): Promise<void>
}
