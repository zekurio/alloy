// clipboard-sanitized-write backs navigator.clipboard.writeText; without it
// Chromium rejects copies that happen after an await (e.g. "copy link once
// the upload finishes"), where the user gesture has already expired.
const MAIN_SESSION_ALLOWED_PERMISSIONS = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
])

export function isAllowedMainSessionPermission(permission: string): boolean {
  return MAIN_SESSION_ALLOWED_PERMISSIONS.has(permission)
}
