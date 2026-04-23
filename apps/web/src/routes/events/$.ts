import { createFileRoute } from "@tanstack/react-router"

import { proxyToUpstream } from "@/lib/upstream-proxy"

const proxy = async ({ request }: { request: Request }) => {
  return proxyToUpstream(request, { signal: request.signal })
}

export const Route = createFileRoute("/events/$")({
  server: {
    handlers: {
      ANY: proxy,
    },
  },
})
