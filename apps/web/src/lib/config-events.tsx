import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"

import { gameKeys } from "./game-queries"
import { invalidateAuthConfig } from "./session-suspense"
import { apiOrigin } from "./env"

type ConfigEvent = {
  authConfigChanged?: boolean
  steamgriddbStatusChanged?: boolean
}

const STREAM_URL = "/api/events/config"

export function ConfigEvents() {
  const queryClient = useQueryClient()
  const router = useRouter()

  React.useEffect(() => {
    const source = new EventSource(new URL(STREAM_URL, apiOrigin()), {
      withCredentials: true,
    })

    const handleConfig = (ev: MessageEvent<string>) => {
      const event = JSON.parse(ev.data) as ConfigEvent
      if (event.authConfigChanged) {
        invalidateAuthConfig()
        void router.invalidate()
      }
      if (event.steamgriddbStatusChanged) {
        void queryClient.invalidateQueries({ queryKey: gameKeys.status() })
      }
    }

    source.addEventListener("config", handleConfig)
    return () => {
      source.removeEventListener("config", handleConfig)
      source.close()
    }
  }, [queryClient, router])

  return null
}
