import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

export const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 10000
export const REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

// Address space an attacker-influenced URL must never reach from the server:
// loopback, unspecified, RFC 1918/6598 private, link-local, IPv6 unique-local.
// IPv4-mapped IPv6 (a classic guard-bypass encoding) is not listed here — a
// mapped subnet makes BlockList match every IPv4 check — and is unwrapped to
// its embedded IPv4 in isPublicAddress instead.
const PRIVATE_ADDRESS_RANGES = new BlockList()
PRIVATE_ADDRESS_RANGES.addSubnet("0.0.0.0", 8)
PRIVATE_ADDRESS_RANGES.addSubnet("10.0.0.0", 8)
PRIVATE_ADDRESS_RANGES.addSubnet("100.64.0.0", 10)
PRIVATE_ADDRESS_RANGES.addSubnet("127.0.0.0", 8)
PRIVATE_ADDRESS_RANGES.addSubnet("169.254.0.0", 16)
PRIVATE_ADDRESS_RANGES.addSubnet("172.16.0.0", 12)
PRIVATE_ADDRESS_RANGES.addSubnet("192.168.0.0", 16)
PRIVATE_ADDRESS_RANGES.addSubnet("::", 128, "ipv6")
PRIVATE_ADDRESS_RANGES.addSubnet("::1", 128, "ipv6")
PRIVATE_ADDRESS_RANGES.addSubnet("fc00::", 7, "ipv6")
PRIVATE_ADDRESS_RANGES.addSubnet("fe80::", 10, "ipv6")

/**
 * True when every address the URL's host resolves to is publicly routable.
 * Resolution failure counts as non-public: the follow-up fetch would fail
 * anyway, and treating it as public would let DNS errors bypass the guard.
 */
export async function resolvesToPublicAddress(url: string): Promise<boolean> {
  const hostname = new URL(url).hostname
  const host =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname
  const literalFamily = isIP(host)
  if (literalFamily) return isPublicAddress(host, literalFamily)

  const addresses = await lookup(host, { all: true }).catch(() => [])
  if (addresses.length === 0) return false
  return addresses.every((entry) =>
    isPublicAddress(entry.address, entry.family),
  )
}

function isPublicAddress(address: string, family: number): boolean {
  const mapped = family === 6 ? mappedIpv4(address) : null
  return mapped
    ? !PRIVATE_ADDRESS_RANGES.check(mapped, "ipv4")
    : !PRIVATE_ADDRESS_RANGES.check(address, family === 6 ? "ipv6" : "ipv4")
}

// Extracts the embedded IPv4 from an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`
// or its hex form `::ffff:7f00:1`), else null. Guards against reaching an
// internal IPv4 host through a mapped-IPv6 encoding.
function mappedIpv4(address: string): string | null {
  const rest = address.toLowerCase().match(/^::ffff:(.+)$/)?.[1]
  if (!rest) return null
  if (isIP(rest) === 4) return rest
  const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return null
  const hi = Number.parseInt(hex[1], 16)
  const lo = Number.parseInt(hex[2], 16)
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
}

export async function fetchRemoteImage(
  url: string,
  label: string,
  signal?: AbortSignal,
  options?: { redirect?: "error" | "follow" },
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(url, {
    signal: boundedRemoteSignal(signal),
    redirect: options?.redirect ?? "follow",
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
