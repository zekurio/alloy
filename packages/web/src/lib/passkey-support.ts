type PasskeySupport = {
  /** Always true. The login and sign-up pages still read it. */
  ready: boolean
  supported: boolean
}

export function usePasskeySupport(): PasskeySupport {
  return { ready: true, supported: Boolean(window.PublicKeyCredential) }
}
