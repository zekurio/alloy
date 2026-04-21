import { createFileRoute } from "@tanstack/react-router"

const UPSTREAM = process.env.INTERNAL_API_URL ?? "http://localhost:3000"

const proxy = async ({ request }: { request: Request }) => {
  const incoming = new URL(request.url)
  const target = new URL(incoming.pathname + incoming.search, UPSTREAM)

  const headers = new Headers(request.headers)
  headers.delete("host")
  headers.delete("connection")
  headers.set("x-forwarded-host", incoming.host)
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""))

  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  }

  if (hasBody) {
    init.body = request.body
    init.duplex = "half"
  }

  return fetch(target, init)
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: proxy,
    },
  },
})
