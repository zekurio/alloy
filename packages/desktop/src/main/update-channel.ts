export type DesktopUpdateChannel = "latest" | "nightly"

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version)
}

export function resolveDesktopUpdateChannel(
  version: string,
): DesktopUpdateChannel {
  return isNightlyDesktopVersion(version) ? "nightly" : "latest"
}

export function isDesktopUpdateForChannel(
  version: string,
  channel: DesktopUpdateChannel,
): boolean {
  return resolveDesktopUpdateChannel(version) === channel
}
