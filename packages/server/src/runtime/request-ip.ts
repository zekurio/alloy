import { BlockList, isIP } from "node:net"

import { env } from "@alloy/server/env"
import { getConnInfo } from "@hono/node-server/conninfo"
import type { Context } from "hono"

import { lazy } from "./lazy"

const trustedProxies = lazy(() => {
  const list = new BlockList()
  for (const entry of env.trustedProxies) {
    const [address = "", prefix] = entry.split("/")
    const type = isIP(address) === 4 ? "ipv4" : "ipv6"
    if (prefix === undefined) list.addAddress(address, type)
    else list.addSubnet(address, Number(prefix), type)
  }
  return list
})

// Loopback, RFC 1918 private ranges, RFC 4193 unique local addresses, and
// link-local addresses: a client here is on the server's own network.
const localNetworks = lazy(() => {
  const list = new BlockList()
  list.addSubnet("127.0.0.0", 8, "ipv4")
  list.addSubnet("10.0.0.0", 8, "ipv4")
  list.addSubnet("172.16.0.0", 12, "ipv4")
  list.addSubnet("192.168.0.0", 16, "ipv4")
  list.addSubnet("169.254.0.0", 16, "ipv4")
  list.addAddress("::1", "ipv6")
  list.addSubnet("fc00::", 7, "ipv6")
  list.addSubnet("fe80::", 10, "ipv6")
  return list
})

const IPV4_MAPPED_PREFIX = "::ffff:"

function normalizedIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return isIP(trimmed) ? trimmed : null
}

function isTrustedProxy(ip: string): boolean {
  return trustedProxies.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6")
}

/**
 * The client address as far as trusted proxies vouch for it. Forwarding
 * headers count only when the socket peer is listed in ALLOY_TRUSTED_PROXIES;
 * then X-Forwarded-For is walked right to left, skipping trusted hops, so a
 * client cannot pick its own address by prepending entries.
 */
function clientIp(input: {
  forwardedFor?: string | null
  realIp?: string | null
  socketAddress: string | null
}): string | null {
  let nearest = input.socketAddress
  if (!nearest || !isTrustedProxy(nearest)) return nearest

  const hops = input.forwardedFor?.split(",") ?? []
  if (!hops.some((hop) => hop.trim())) {
    return normalizedIp(input.realIp) ?? nearest
  }
  for (let index = hops.length - 1; index >= 0; index--) {
    const ip = normalizedIp(hops[index])
    // An unparseable hop ends the chain the trusted proxies vouch for.
    if (!ip) return nearest
    if (!isTrustedProxy(ip)) return ip
    nearest = ip
  }
  return nearest
}

function socketIp(c: Context): string | null {
  try {
    return normalizedIp(getConnInfo(c).remote.address)
  } catch {
    return null
  }
}

export function requestIp(c: Context): string | null {
  return clientIp({
    forwardedFor: c.req.header("x-forwarded-for"),
    realIp: c.req.header("x-real-ip"),
    socketAddress: socketIp(c),
  })
}

function isLocalNetworkIp(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)
    ? ip.slice(IPV4_MAPPED_PREFIX.length)
    : ip
  const address = isIP(mapped) === 4 ? mapped : ip
  return localNetworks.check(address, isIP(address) === 4 ? "ipv4" : "ipv6")
}

/**
 * Whether the client is on the server's local network. A request that an
 * untrusted peer forwarded proves nothing about the client: a reverse proxy
 * on the same host would make everyone look local, so it counts as remote
 * until ALLOY_TRUSTED_PROXIES vouches for the proxy.
 */
export function isLocalNetworkRequest(c: Context): boolean {
  const socket = socketIp(c)
  if (!socket) return false
  const forwarded = ["x-forwarded-for", "x-real-ip", "forwarded"].some(
    (name) => c.req.header(name) !== undefined,
  )
  if (forwarded && !isTrustedProxy(socket)) return false
  const ip = requestIp(c)
  return ip !== null && isLocalNetworkIp(ip)
}
