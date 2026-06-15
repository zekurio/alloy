import { existsSync } from "node:fs"
import { join } from "node:path"

import { currentOutputFolder } from "./recording-storage"

export function captureCollectionFolder(
  collection: "Clips" | "Sessions",
  gameName: string | null,
): string {
  return join(
    currentOutputFolder(),
    collection,
    fileComponent(gameName, "Desktop"),
  )
}

export function uniqueCaptureFilename(
  root: string,
  base: string,
  extension: string,
): string {
  let filename = join(root, `${base}${extension}`)
  for (let counter = 2; existsSync(filename); counter++) {
    filename = join(root, `${base}-${counter}${extension}`)
  }
  return filename
}

function fileComponent(value: string | null, fallback: string): string {
  let component = ""
  let previousWasSeparator = false

  for (const char of value?.trim() ?? "") {
    const replacement = isUnsafePathCharacter(char) ? "-" : char
    const isWhitespace = /\s/.test(replacement)
    if (replacement === "-" || isWhitespace) {
      if (!previousWasSeparator && component.length > 0) {
        component += isWhitespace ? " " : "-"
        previousWasSeparator = true
      }
      continue
    }

    component += replacement
    previousWasSeparator = false
  }

  component = component.replace(/^[ .-]+|[ .-]+$/g, "")
  return component.length > 0 && !isReservedWindowsName(component)
    ? component
    : fallback
}

function isUnsafePathCharacter(value: string): boolean {
  const code = value.charCodeAt(0)
  return (
    code < 32 ||
    code === 127 ||
    value === "<" ||
    value === ">" ||
    value === ":" ||
    value === '"' ||
    value === "/" ||
    value === "\\" ||
    value === "|" ||
    value === "?" ||
    value === "*"
  )
}

function isReservedWindowsName(value: string): boolean {
  const base = value.split(".")[0]?.toUpperCase()
  return (
    base === "CON" ||
    base === "PRN" ||
    base === "AUX" ||
    base === "NUL" ||
    /^COM[1-9]$/.test(base ?? "") ||
    /^LPT[1-9]$/.test(base ?? "")
  )
}
