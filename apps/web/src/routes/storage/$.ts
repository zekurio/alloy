import { createFileRoute } from "@tanstack/react-router"

import { proxyToUpstream } from "@/lib/upstream-proxy"

const USER_ASSET_PREFIX = "/storage/user-assets/"
const DIRECT_USER_ASSET_BASE =
  process.env.PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production"
    ? null
    : (process.env.INTERNAL_API_URL ?? "http://localhost:3000"))

const proxy = async ({ request }: { request: Request }) => {
  const direct = directUserAssetRedirect(request)
  if (direct) return direct

  return proxyToUpstream(request, { signal: request.signal })
}

export const Route = createFileRoute("/storage/$")({
  server: {
    handlers: {
      ANY: proxy,
    },
  },
})

function directUserAssetRedirect(request: Request): Response | null {
  if (
    !DIRECT_USER_ASSET_BASE ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return null
  }

  const incoming = new URL(request.url)
  if (!incoming.pathname.startsWith(USER_ASSET_PREFIX)) return null

  const target = new URL(
    incoming.pathname + incoming.search,
    DIRECT_USER_ASSET_BASE
  )
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "public, max-age=60",
    },
  })
}
