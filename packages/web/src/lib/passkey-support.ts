import { useSyncExternalStore } from "react"

type PasskeySupport = {
  ready: boolean
  supported: boolean
}

function hasPasskeySupport(): boolean {
  return Boolean(globalThis.window?.PublicKeyCredential)
}

function subscribe(): () => void {
  return () => {
    // No external store: this hook only needs a hydration-safe client snapshot.
  }
}

export function usePasskeySupport(): PasskeySupport {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

  return {
    ready: isClient,
    supported: isClient && hasPasskeySupport(),
  }
}
