import { readFileSync, readdirSync } from "node:fs"
import { resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

import { DEFAULT_LOCALE } from "../src"
import { LOCALES, SUPPORTED_LOCALES } from "../src/locales"
import { validateCatalog } from "./catalog-validation"
import { extractSourceMessages } from "./source-messages"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const packages = resolve(root, "packages")
const sourceMessages = readdirSync(packages, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "i18n")
  .flatMap((entry) => {
    const directory = resolve(packages, entry.name, "src")
    return readdirSync(directory, { recursive: true, encoding: "utf8" })
      .filter(
        (path) =>
          /\.(ts|tsx)$/.test(path) && !/\.(test|spec|gen|d)\./.test(path),
      )
      .map((path) => {
        const filename = resolve(directory, path)
        return {
          filename: relative(root, filename),
          ...extractSourceMessages(
            readFileSync(filename, "utf8"),
            relative(root, filename),
          ),
        }
      })
  })

// Keep known runtime/server errors covered even when no literal call references
// them. Every locale must also cover messages found in the other catalogs.
const sourceKeys = new Set([
  ...sourceMessages.flatMap((source) =>
    source.messages.map((message) => message.key),
  ),
  ...SUPPORTED_LOCALES.flatMap((locale) =>
    Object.keys(LOCALES[locale].messages),
  ),
])

test("application source uses extractable translation templates", () => {
  expect(
    sourceMessages.flatMap((source) => source.messages).length,
  ).toBeGreaterThan(0)
  expect(sourceMessages.flatMap((source) => source.errors)).toEqual([])
})

describe.each(SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE))(
  "%s catalog",
  (locale) => {
    test("translates every source message without losing placeholders or spacing", () => {
      const issues = validateCatalog(LOCALES[locale].messages, sourceKeys)
      const locations = sourceMessages.flatMap((source) =>
        source.messages
          .filter(
            (message) => !Object.hasOwn(LOCALES[locale].messages, message.key),
          )
          .map(
            (message) =>
              `${source.filename}:${message.line}: ${JSON.stringify(message.key)}`,
          ),
      )
      expect({ issues, locations }).toEqual({ issues: [], locations: [] })
    })
  },
)
