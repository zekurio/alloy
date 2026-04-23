import * as React from "react"

type PasskeySupport = {
  ready: boolean
  supported: boolean
}

function hasPasskeySupport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined"
  )
}

function subscribe(): () => void {
  return () => {}
}

/**
 * Synchronously resolves passkey browser support on the client.
 *
 * Returns `ready: false` on the server so page components can gate their
 * render — server and first hydration render both produce `null`, then
 * React's synchronous fixup renders the correct form before the first paint.
 */
export function usePasskeySupport(): PasskeySupport {
  const isClient = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

  return {
    ready: isClient,
    supported: isClient && hasPasskeySupport(),
  }
}
