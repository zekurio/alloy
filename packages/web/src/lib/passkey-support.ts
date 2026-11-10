/** Whether this browser can create and use passkeys (WebAuthn). */
export function passkeysSupported(): boolean {
  return Boolean(window.PublicKeyCredential)
}
