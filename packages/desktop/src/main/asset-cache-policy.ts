/** Allow only selected-server game assets and SteamGridDB's fixed CDN. */
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
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname.length <= 1024 &&
    (hostname === "steamgriddb.com" || hostname.endsWith(".steamgriddb.com"))
  )
}
