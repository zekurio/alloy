import { AwsClient } from "aws4fetch"
import { once } from "node:events"
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "node:http"
import { request as httpsRequest } from "node:https"

export async function signedStreamPut(
  client: AwsClient,
  url: URL,
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array>,
  key: string
): Promise<void> {
  const signed = await client.sign(url, {
    method: "PUT",
    headers,
  })
  const res = await putWithContentLength(signed.url, signed.headers, body)
  if (res.status >= 200 && res.status < 300) return
  throw new Error(
    `s3: upload ${key} failed with ${res.status} ${res.statusText}${
      res.body ? `: ${res.body}` : ""
    }`
  )
}

function putWithContentLength(
  url: string,
  headers: Headers,
  body: ReadableStream<Uint8Array>
): Promise<{ status: number; statusText: string; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const request = parsed.protocol === "http:" ? httpRequest : httpsRequest
    const req = request(
      parsed,
      {
        method: "PUT",
        headers: Object.fromEntries(headers.entries()),
      },
      (res) => {
        void readNodeResponse(res).then(resolve, reject)
      }
    )
    req.on("error", reject)
    void writeStreamToRequest(body, req).catch((err) => {
      req.destroy(err instanceof Error ? err : new Error(String(err)))
      reject(err)
    })
  })
}

async function writeStreamToRequest(
  body: ReadableStream<Uint8Array>,
  req: ClientRequest
): Promise<void> {
  const reader = body.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!req.write(next.value)) {
        await once(req, "drain")
      }
    }
    req.end()
  } finally {
    reader.releaseLock()
  }
}

function readNodeResponse(
  res: IncomingMessage
): Promise<{ status: number; statusText: string; body: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    res.on("data", (chunk: Uint8Array) => chunks.push(chunk))
    res.on("error", reject)
    res.on("end", () => {
      const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
      const joined = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve({
        status: res.statusCode ?? 0,
        statusText: res.statusMessage ?? "",
        body: new TextDecoder().decode(joined),
      })
    })
  })
}

export async function readStream(
  body: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = body.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
      size += next.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}
