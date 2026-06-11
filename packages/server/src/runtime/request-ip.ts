import { isIP } from "node:net"

import { getConnInfo } from "@hono/node-server/conninfo"
import type { Context } from "hono"

function normalizedIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return isIP(trimmed) ? trimmed : null
}

function forwardedForIp(value: string | null | undefined): string | null {
  return normalizedIp(value?.split(",")[0])
}

export function requestIpFromHeaderValues(input: {
  forwardedFor?: string | null
  realIp?: string | null
  socketAddress?: string | null
}): string | null {
  return (
    forwardedForIp(input.forwardedFor) ??
    normalizedIp(input.realIp) ??
    normalizedIp(input.socketAddress)
  )
}

export function requestIp(c: Context): string | null {
  let socketAddress: string | null = null
  try {
    socketAddress = getConnInfo(c).remote.address ?? null
  } catch {
    socketAddress = null
  }

  return requestIpFromHeaderValues({
    forwardedFor: c.req.header("x-forwarded-for"),
    realIp: c.req.header("x-real-ip"),
    socketAddress,
  })
}
