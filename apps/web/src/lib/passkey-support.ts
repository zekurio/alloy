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

export function usePasskeySupport(): PasskeySupport {
  const isClient = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )

  return {
    ready: isClient,
    supported: isClient && hasPasskeySupport(),
  }
}
