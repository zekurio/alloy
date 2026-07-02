export type ParsedRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number }

/** Parse an HTTP `Range: bytes=A-B` header into inclusive byte offsets. */
export function parseRange(
  rangeHeader: string | undefined,
  size: number,
): ParsedRange {
  if (!rangeHeader) return { kind: "none" }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return { kind: "none" }
  const startStr = match[1] ?? ""
  const endStr = match[2] ?? ""
  if (startStr === "" && endStr !== "") {
    const suffix = Number.parseInt(endStr, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return { kind: "unsatisfiable" }
    }
    const start = Math.max(0, size - suffix)
    const end = size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return { kind: "unsatisfiable" }
    }
    return { kind: "range", start, end }
  }
  if (startStr === "") return { kind: "none" }

  const start = Number.parseInt(startStr, 10)
  const requestedEnd = endStr ? Number.parseInt(endStr, 10) : size - 1
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(requestedEnd) ||
    start < 0 ||
    start >= size
  ) {
    return { kind: "unsatisfiable" }
  }

  const end = Math.min(requestedEnd, size - 1)
  if (start > end) return { kind: "unsatisfiable" }
  return { kind: "range", start, end }
}
