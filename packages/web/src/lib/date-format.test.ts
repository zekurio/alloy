import assert from "node:assert/strict"
import test from "node:test"

import { getRuntimeLocale, localeToLanguageTag } from "@alloy/i18n"

import { formatRelativeTime } from "./date-format"

const now = Date.UTC(2026, 0, 1, 12)
const formatter = new Intl.RelativeTimeFormat(
  localeToLanguageTag(getRuntimeLocale()),
  { numeric: "auto", style: "short" },
)

test("formatRelativeTime preserves future timestamps", () => {
  assert.equal(
    formatRelativeTime(new Date(now + 10 * 60_000), now),
    formatter.format(10, "minute"),
  )
})

test("formatRelativeTime formats past timestamps", () => {
  assert.equal(
    formatRelativeTime(new Date(now - 10 * 60_000), now),
    formatter.format(-10, "minute"),
  )
})
