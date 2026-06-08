const MAIN_SESSION_ALLOWED_PERMISSIONS = new Set(["fullscreen"])

export function isAllowedMainSessionPermission(permission: string): boolean {
  return MAIN_SESSION_ALLOWED_PERMISSIONS.has(permission)
}
