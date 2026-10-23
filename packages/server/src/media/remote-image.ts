import { lookup as dnsLookup } from "node:dns"
import { lookup } from "node:dns/promises"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP, type LookupFunction } from "node:net"

const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 10000
const REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const REMOTE_IMAGE_MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

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
 * A pre-flight answer only; {@link fetchRemoteImage} enforces the same rule
 * on the addresses it actually connects to.
 */
export async function resolvesToPublicAddress(url: string): Promise<boolean> {
  const host = urlHost(new URL(url))
  const literalFamily = isIP(host)
  if (literalFamily) return isPublicAddress(host, literalFamily)

  const addresses = await lookup(host, { all: true }).catch(() => [])
  if (addresses.length === 0) return false
  return addresses.every((entry) =>
    isPublicAddress(entry.address, entry.family),
  )
}

function urlHost(url: URL): string {
  const { hostname } = url
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
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

/**
 * Socket lookup that refuses hosts resolving to any non-public address. The
 * socket connects to exactly the addresses checked here, so a DNS answer that
 * changes between a pre-flight check and the connection cannot slip through.
 */
const publicAddressLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, "")
      return
    }
    const [first] = addresses
    const allPublic = addresses.every((entry) =>
      isPublicAddress(entry.address, entry.family),
    )
    if (!first || !allPublic) {
      callback(nonPublicAddressError(hostname), "")
    } else if (options.all) {
      callback(null, addresses)
    } else {
      callback(null, first.address, first.family)
    }
  })
}

function nonPublicAddressError(host: string): Error {
  return new Error(`${host} does not resolve to a public address`)
}

/**
 * Download an http(s) image, bounded by a timeout and `maxBytes`. Unless
 * `allowPrivate` is set, every connection, including each followed redirect,
 * may only reach publicly routable addresses.
 */
export async function fetchRemoteImage(
  url: string,
  label: string,
  signal?: AbortSignal,
  options?: {
    redirect?: "error" | "follow"
    maxBytes?: number
    allowPrivate?: boolean
  },
): Promise<{ bytes: Buffer; contentType: string }> {
  const maxBytes = options?.maxBytes ?? REMOTE_IMAGE_MAX_BYTES
  const response = await openRemoteImage(new URL(url), label, {
    signal: boundedRemoteSignal(signal),
    followRedirects: options?.redirect !== "error",
    allowPrivate: options?.allowPrivate ?? false,
  })
  try {
    const status = response.statusCode ?? 0
    if (status < 200 || status > 299) {
      throw new Error(`${label}: fetch failed with status ${status}`)
    }
    const contentType = response.headers["content-type"] ?? ""
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`${label}: expected image content type`)
    }
    const contentLength = response.headers["content-length"]
    if (contentLength !== undefined && Number(contentLength) > maxBytes) {
      throw new Error(`${label}: image exceeds byte limit`)
    }
    return {
      bytes: await readBoundedRemoteBody(response, label, maxBytes),
      contentType: contentType.split(";")[0]?.trim().toLowerCase() ?? "",
    }
  } catch (err) {
    response.destroy()
    throw err
  }
}

async function openRemoteImage(
  url: URL,
  label: string,
  options: {
    signal: AbortSignal
    followRedirects: boolean
    allowPrivate: boolean
  },
): Promise<IncomingMessage> {
  for (let redirects = 0; ; redirects += 1) {
    const response = await requestRemoteImage(url, label, options)
    const location = response.headers.location
    if (!REDIRECT_STATUSES.has(response.statusCode ?? 0) || !location) {
      return response
    }
    response.destroy()
    if (!options.followRedirects) {
      throw new Error(`${label}: redirect refused`)
    }
    if (redirects >= REMOTE_IMAGE_MAX_REDIRECTS) {
      throw new Error(`${label}: too many redirects`)
    }
    url = new URL(location, url)
  }
}

function requestRemoteImage(
  url: URL,
  label: string,
  options: { signal: AbortSignal; allowPrivate: boolean },
): Promise<IncomingMessage> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error(`${label}: URL must use http or https`))
  }
  const host = urlHost(url)
  const literalFamily = isIP(host)
  // Literal addresses connect without a lookup, so the hook never sees them.
  if (
    !options.allowPrivate &&
    literalFamily &&
    !isPublicAddress(host, literalFamily)
  ) {
    return Promise.reject(nonPublicAddressError(host))
  }
  const request = url.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    request(
      url,
      {
        // A pooled keep-alive socket may have been opened without the guard.
        agent: false,
        headers: { accept: "image/*", "user-agent": "Alloy" },
        lookup: options.allowPrivate ? undefined : publicAddressLookup,
        signal: options.signal,
      },
      resolve,
    )
      .on("error", reject)
      .end()
  })
}

async function readBoundedRemoteBody(
  response: IncomingMessage,
  label: string,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  // SAFETY: without setEncoding, an IncomingMessage yields Buffer chunks.
  for await (const chunk of response as AsyncIterable<Buffer>) {
    total += chunk.byteLength
    if (total > maxBytes) {
      throw new Error(`${label}: image exceeds byte limit`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

function boundedRemoteSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}
