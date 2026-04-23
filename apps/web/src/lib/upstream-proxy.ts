const UPSTREAM = process.env.INTERNAL_API_URL ?? "http://localhost:3000"

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

    return Response.json(
      { error: "Upstream API unavailable" },
      { status: 502, statusText: "Bad Gateway" }
    )
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}
