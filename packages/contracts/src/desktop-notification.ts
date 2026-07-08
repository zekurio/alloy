/**
 * Native desktop notification payload the web app sends through the desktop
 * bridge. This never goes through the server — the desktop shell validates it
 * before showing an OS notification.
 */
export interface DesktopNotificationInput {
  title: string
  body: string
  targetPath: string
}

/** Desktop notification controls bridged into the web app. */
export interface AlloyDesktopNotificationsApi {
  show(input: DesktopNotificationInput): Promise<void>
}
