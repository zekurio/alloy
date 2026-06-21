import type { DesktopUpdateChannel } from "@alloy/contracts"

const UNSTABLE_VERSION_PATTERN = /-unstable\.\d{8}\.\d+$/

export function isUnstableDesktopVersion(version: string): boolean {
  return UNSTABLE_VERSION_PATTERN.test(version)
}

export function resolveDesktopUpdateChannel(
  version: string,
): DesktopUpdateChannel {
  return isUnstableDesktopVersion(version) ? "unstable" : "latest"
}

export function isDesktopUpdateForChannel(
  version: string,
  channel: DesktopUpdateChannel,
): boolean {
  return resolveDesktopUpdateChannel(version) === channel
}
