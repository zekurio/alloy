import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  isCallExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type Expression,
  type Node,
  type SourceFile,
} from "typescript/unstable/ast"
import { API } from "typescript/unstable/sync"

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
    return (
      manifest?.dependencies?.["@alloy/i18n"] !== undefined ||
      // The desktop package consumes @alloy/i18n from devDependencies since
      // electron-vite bundles everything; both sections count as "depends on".
      manifest?.devDependencies?.["@alloy/i18n"] !== undefined
    )
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

// Keys consumed through dynamic t() calls that static extraction can't see:
// comment-emoji-picker.tsx renders t(group.label) over EMOJI_GROUPS.
const DYNAMIC_KEYS: Record<string, true> = {
  Smileys: true,
  Gestures: true,
  Hearts: true,
  Animals: true,
  Food: true,
  Activities: true,
  Objects: true,
  Symbols: true,
}

test("every German translation corresponds to a used key", () => {
  const orphaned = Object.keys(DE_MESSAGES)
    .filter((key) => !usedKeys.has(key) && !Object.hasOwn(DYNAMIC_KEYS, key))
    .sort()
  assert.deepEqual(
    orphaned,
    [],
    `Remove stale entries from packages/i18n/src/messages.ts (or add them to DYNAMIC_KEYS if reached via a dynamic call):\n${orphaned.join("\n")}`,
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

function readManifest(path: string): {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
} | null {
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
  const api = new API({ cwd: dirname(packagesDir) })
  const snapshot = api.updateSnapshot({
    openProjects: roots.map((root) => join(root, "../tsconfig.json")),
  })
  const keys = new Map<string, string>()
  for (const root of roots) {
    const project = snapshot
      .getProjects()
      .find((candidate) => dirname(candidate.configFileName) === dirname(root))
    if (project === undefined) {
      throw new Error(`TypeScript did not load a project for ${root}`)
    }
    for (const file of sourceFiles(root)) {
      const sourceFile = project.program.getSourceFile(file)
      if (sourceFile === undefined) {
        throw new Error(`TypeScript did not load ${file}`)
      }
      collectFileKeys(
        sourceFile,
        keys,
        `packages/${relative(packagesDir, file)}`,
      )
    }
  }
  snapshot.dispose()
  api.close()
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
  sourceFile: SourceFile,
  keys: Map<string, string>,
  displayPath: string,
): void {
  if (!/\b(t|tp|translate|translatePlural)\(/.test(sourceFile.text)) return

  const addKey = (key: string) => {
    if (!keys.has(key)) keys.set(key, displayPath)
  }
  const visit = (node: Node): void => {
    if (isCallExpression(node) && isIdentifier(node.expression)) {
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
    node.forEachChild(visit)
  }
  visit(sourceFile)
}

function literalText(node: Expression | undefined): string | null {
  if (node === undefined) return null
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}
