export function normalizeObjectPath(path: string): string {
  const parts = path
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== ".")
  if (parts.some((part) => part === "..")) {
    throw new Error("Storage path must not contain '..' segments")
  }
  return parts.join("/")
}
