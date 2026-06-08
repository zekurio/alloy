const SEP = "/"

export function isAbsolute(path: string): boolean {
  return (
    path.startsWith(SEP) ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[/\\]/.test(path)
  )
}

export function normalize(path: string): string {
  const input = path.replaceAll("\\", SEP)
  const uncMatch = /^(\/\/[^/]+\/[^/]+)(?:\/|$)/.exec(input)
  const driveMatch = /^([A-Za-z]:)(?:\/|$)/.exec(input)
  const prefix = uncMatch
    ? `${uncMatch[1]}${SEP}`
    : driveMatch
      ? `${driveMatch[1]}${SEP}`
      : ""
  const absolute = prefix.length > 0 || input.startsWith(SEP)
  const parts: string[] = []

  const body = prefix ? input.slice(prefix.length) : input
  for (const part of body.split(SEP)) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop()
      } else if (!absolute) {
        parts.push(part)
      }
      continue
    }
    parts.push(part)
  }

  const root = prefix || (absolute ? SEP : "")
  const normalized = `${root}${parts.join(SEP)}`
  return normalized || root || "."
}

export function resolve(...paths: string[]): string {
  let resolved = ""

  for (let i = paths.length - 1; i >= 0; i -= 1) {
    const path = paths[i]
    if (!path) continue
    resolved = resolved ? `${path}${SEP}${resolved}` : path
    if (isAbsolute(path)) return normalize(resolved)
  }

  return normalize(`${process.cwd()}${SEP}${resolved}`)
}

export function join(...paths: string[]): string {
  return normalize(paths.filter(Boolean).join(SEP))
}

export function dirname(path: string): string {
  const normalized = normalize(path)
  if (normalized === SEP) return SEP
  const index = normalized.lastIndexOf(SEP)
  if (index < 0) return "."
  if (index === 0) return SEP
  return normalized.slice(0, index)
}

export function relative(from: string, to: string): string {
  const fromParts = normalize(resolve(from)).split(SEP).filter(Boolean)
  const toParts = normalize(resolve(to)).split(SEP).filter(Boolean)

  let shared = 0
  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1
  }

  const up = Array(fromParts.length - shared).fill("..")
  const down = toParts.slice(shared)
  return [...up, ...down].join(SEP) || ""
}
