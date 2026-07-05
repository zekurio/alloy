export const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 10000
export const REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export async function fetchRemoteImage(
  url: string,
  label: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(url, {
    signal: boundedRemoteSignal(signal),
  })
  if (!response.ok) {
    throw new Error(`${label}: fetch failed with status ${response.status}`)
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`${label}: expected image content type`)
  }
  const contentLength = response.headers.get("content-length")
  if (
    contentLength !== null &&
    Number(contentLength) > REMOTE_IMAGE_MAX_BYTES
  ) {
    throw new Error(`${label}: image exceeds byte limit`)
  }
  return {
    bytes: Buffer.from(await readBoundedRemoteBody(response, label)),
    contentType: contentType.split(";")[0]?.trim().toLowerCase() ?? "",
  }
}

async function readBoundedRemoteBody(
  response: Response,
  label: string,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader()
  if (!reader) return response.arrayBuffer()

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > REMOTE_IMAGE_MAX_BYTES) {
        throw new Error(`${label}: image exceeds byte limit`)
      }
      chunks.push(value)
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined)
    throw err
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

function boundedRemoteSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}
