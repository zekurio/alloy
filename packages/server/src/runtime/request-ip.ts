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

export function requestIp(c: Context): string | null {
  let socketAddress: string | null = null
  try {
    socketAddress = getConnInfo(c).remote.address ?? null
  } catch {
    socketAddress = null
  }

  return clientIp({
    forwardedFor: c.req.header("x-forwarded-for"),
    realIp: c.req.header("x-real-ip"),
    socketAddress: normalizedIp(socketAddress),
  })
}
