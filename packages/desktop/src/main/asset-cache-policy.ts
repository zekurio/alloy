/** Allow only known public game-art sources used by the desktop renderer. */
export function isAllowedAssetSource(
  rawUrl: string,
  selectedServer: string | null,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.username || url.password) return false

  if (
    selectedServer &&
    url.origin === selectedServer &&
    url.pathname.startsWith("/api/assets/games/")
  ) {
    return true
  }

  const hostname = url.hostname.toLowerCase()
  const isSteamGridDB =
    hostname === "steamgriddb.com" || hostname.endsWith(".steamgriddb.com")
  const isDiscordApplicationIcon =
    hostname === "cdn.discordapp.com" &&
    /^\/app-icons\/[0-9]+\/[A-Za-z0-9_-]+\.png$/.test(url.pathname)
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname.length <= 1024 &&
    (isSteamGridDB || isDiscordApplicationIcon)
  )
}
