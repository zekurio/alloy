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

export function usePasskeySupport(): PasskeySupport {
  const [state, setState] = React.useState<PasskeySupport>({
    ready: false,
    supported: false,
  })

  React.useEffect(() => {
    setState({
      ready: true,
      supported: hasPasskeySupport(),
    })
  }, [])

  return state
}
