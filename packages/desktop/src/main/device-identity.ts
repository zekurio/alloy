import { hostname } from "node:os"

import { logger } from "@alloy/logging"

import { MainApiError, registerDevice } from "./main-api"
import { getOrCreateDeviceId, replaceDeviceId } from "./server-store"

/**
 * Registers this install as a device on the connected server so synced clips
 * carry an origin. Registration is an idempotent PUT; per-server success is
 * cached for the process lifetime (the PUT also refreshes lastSeenAt, so once
 * per launch is the right cadence).
 */

const registeredServers = new Set<string>()

export function deviceDisplayName(): string {
  try {
    return hostname() || "Desktop"
  } catch {
    return "Desktop"
  }
}

export async function ensureDeviceRegistered(
  serverUrl: string,
): Promise<string> {
  const deviceId = getOrCreateDeviceId()
  if (registeredServers.has(serverUrl)) return deviceId

  const input = { name: deviceDisplayName(), platform: process.platform }
  try {
    await registerDevice(serverUrl, deviceId, input)
    registeredServers.add(serverUrl)
    return deviceId
  } catch (cause) {
    // 409 = the id belongs to another account on this server (copied
    // preferences file, reinstall under a new user). Mint a fresh identity.
    if (cause instanceof MainApiError && cause.status === 409) {
      const fresh = replaceDeviceId()
      logger.warn("[desktop] device id collided on server; regenerated")
      await registerDevice(serverUrl, fresh, input)
      registeredServers.add(serverUrl)
      return fresh
    }
    throw cause
  }
}
