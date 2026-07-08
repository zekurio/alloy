import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import ts from "typescript"

import { DE_MESSAGES } from "./messages"

// English strings are the translation keys, so a key missing from DE_MESSAGES
// silently falls back to English for German users. This suite statically
// extracts every literal key passed to t()/tp()/translate()/translatePlural()
// across the workspace packages that depend on @alloy/i18n and asserts full
// German coverage. Dynamic keys (non-literal arguments) cannot be checked
// statically and are skipped.
const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "../..")

const sourceRoots = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesDir, entry.name))
  .filter((dir) => {
    const manifest = readManifest(join(dir, "package.json"))
    return manifest?.dependencies?.["@alloy/i18n"] !== undefined
  })
  .map((dir) => join(dir, "src"))

const usedKeys = extractTranslationKeys(sourceRoots)

test("workspace translation keys were extracted", () => {
  assert.ok(sourceRoots.length > 0, "no packages depend on @alloy/i18n")
  assert.ok(usedKeys.size > 0, "no translation keys were extracted")
})

test("every literal translation key has a German translation", () => {
  const missing = [...usedKeys]
    .filter(([key]) => !Object.hasOwn(DE_MESSAGES, key))
    .map(([key, file]) => `${JSON.stringify(key)} (${file})`)
    .sort()
  assert.deepEqual(
    missing,
    [],
    `Add German translations to packages/i18n/src/messages.ts for:\n${missing.join("\n")}`,
  )
})

test("German translations only use placeholders present in their key", () => {
  const violations = Object.entries(DE_MESSAGES)
    .filter(([key, value]) => {
      const known = placeholders(key)
      return [...placeholders(value)].some((name) => !known.has(name))
    })
    .map(([key]) => key)
  assert.deepEqual(violations, [])
})

function readManifest(
  path: string,
): { dependencies?: Record<string, string> } | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

// Same placeholder grammar as interpolate() in src/index.ts.
function placeholders(value: string): Set<string> {
  return new Set(
    [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]),
  )
}

function extractTranslationKeys(roots: string[]): Map<string, string> {
  const keys = new Map<string, string>()
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      collectFileKeys(file, keys, `packages/${relative(packagesDir, file)}`)
    }
  }
  return keys
}

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    files.push(full)
  }
  return files
}

function collectFileKeys(
  file: string,
  keys: Map<string, string>,
  displayPath: string,
): void {
  const source = readFileSync(file, "utf8")
  if (!/\b(t|tp|translate|translatePlural)\(/.test(source)) return

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const addKey = (key: string) => {
    if (!keys.has(key)) keys.set(key, displayPath)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      if (name === "t" || name === "translate") {
        const key = literalText(node.arguments[name === "t" ? 0 : 1])
        if (key !== null) addKey(key)
      }
      if (name === "tp" || name === "translatePlural") {
        const base = name === "tp" ? 1 : 2
        const one = literalText(node.arguments[base])
        if (one !== null) {
          addKey(one)
          const other = literalText(node.arguments[base + 1])
          addKey(other !== null ? other : `${one}s`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}
