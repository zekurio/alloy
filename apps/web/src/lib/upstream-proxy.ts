const UPSTREAM = process.env.INTERNAL_API_URL ?? "http://localhost:3000"
const EVENT_STREAM_RETRY_MS = 10_000

type ProxyOptions = {
  signal?: AbortSignal
}

export async function proxyToUpstream(
  request: Request,
  options: ProxyOptions = {}
): Promise<Response> {
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
    signal: options.signal,
  }

  if (hasBody) {
    init.body = request.body
    init.duplex = "half"
  }

  try {
    return await fetch(target, init)
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      return new Response(null, {
        status: 499,
        statusText: "Client Closed Request",
      })
    }

    if (isEventStreamRequest(request)) {
      return eventStreamRetryResponse()
    }

    return Response.json(
      { error: "Upstream API unavailable" },
      { status: 502, statusText: "Bad Gateway" }
    )
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  )
}

function isEventStreamRequest(request: Request): boolean {
  const accept = request.headers.get("accept")
  return accept?.includes("text/event-stream") ?? false
}

function eventStreamRetryResponse(): Response {
  return new Response(`retry: ${EVENT_STREAM_RETRY_MS}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    },
  })
}
