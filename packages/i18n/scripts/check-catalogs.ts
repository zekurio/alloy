// Fails when a literal English key passed to t(), tp(), translate() or
// message() in packages/*/src has no entry in a non-English catalog. Keys
// built at runtime (server errors, settings metadata) are not covered.
import { globSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { LOCALES, SUPPORTED_LOCALES } from "../src/locales"

const root = join(import.meta.dirname, "../../..")

// A quoted string, or a template literal without placeholders.
const STRING = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\$]|\\.)*\x60)`
// The first argument of tp(): a count expression with at most one call in it.
const COUNT = String.raw`[^,()]+(?:\([^()]*\))?`
const CALLS = [
  new RegExp(String.raw`(?<![\w.])(?:t|message)\(\s*${STRING}`, "g"),
  new RegExp(String.raw`(?<![\w.])translate\(\s*[^,()]+,\s*${STRING}`, "g"),
  new RegExp(
    String.raw`(?<![\w.])tp\(\s*${COUNT},\s*${STRING}(?:\s*,\s*${STRING})?`,
    "g",
  ),
]

const unquote = (literal: string) =>
  literal
    .slice(1, -1)
    .replace(/\\(.)/g, (_, char: string) =>
      char === "n" ? "\n" : char === "t" ? "\t" : char,
    )

/** English key -> first file that uses it. */
const keys = new Map<string, string>()
const files = globSync("packages/*/src/**/*.{ts,tsx}", {
  cwd: root,
  exclude: ["packages/i18n/**"],
})
for (const file of files.sort()) {
  const source = readFileSync(join(root, file), "utf8")
  for (const call of CALLS) {
    for (const match of source.matchAll(call)) {
      for (const literal of match.slice(1)) {
        if (literal && !keys.has(unquote(literal))) {
          keys.set(unquote(literal), file)
        }
      }
    }
  }
}

let missing = 0
for (const locale of SUPPORTED_LOCALES.filter((locale) => locale !== "en")) {
  const { messages } = LOCALES[locale]
  for (const [key, file] of keys) {
    if (Object.hasOwn(messages, key)) continue
    missing++
    process.stderr.write(
      `${locale}: missing ${JSON.stringify(key)} (${file})\n`,
    )
  }
}

if (missing) {
  process.stderr.write(
    `${missing} translation(s) missing; add them to src/catalogs (see packages/i18n/README.md).\n`,
  )
  process.exit(1)
}
process.stdout.write(`i18n: ${keys.size} source keys, all translated\n`)
