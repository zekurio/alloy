import { describe, expect, test } from "vitest"

import { validateCatalog } from "./catalog-validation"
import { extractSourceMessages } from "./source-messages"

describe("source message extraction", () => {
  test("handles aliases, namespaces, escaped and multiline literals without matching unrelated calls", () => {
    const result = extractSourceMessages(
      `
      import { t as text, translate, message } from "@alloy/i18n"
      import * as i18n from "@alloy/i18n"
      text("Couldn't save")
      text(
        "Multiple lines"
      )
      i18n.t("Settings")
      translate(locale, "Hello {name}", { name })
      message("Resolution")
      other.t("not a message")
      // text("not a message either")
    `,
      "example.tsx",
    )
    expect(result.errors).toEqual([])
    expect(result.messages.map((message) => message.key)).toEqual([
      "Couldn't save",
      "Multiple lines",
      "Settings",
      "Hello {name}",
      "Resolution",
    ])
  })

  test("covers both plural forms, including the default suffix and conditionals", () => {
    const result = extractSourceMessages(
      `
      import { t, tp, translatePlural } from "@alloy/i18n"
      tp(count, "view")
      tp(count, "person", "people")
      translatePlural(locale, count, "clip", undefined)
      t(active ? "On" : "Off")
    `,
      "example.ts",
    )
    expect(result.messages.map((message) => message.key)).toEqual([
      "view",
      "views",
      "person",
      "people",
      "clip",
      "clips",
      "On",
      "Off",
    ])
  })

  test("rejects interpolated templates and computed deferred messages", () => {
    const result = extractSourceMessages(
      'import { t, message } from "@alloy/i18n"; t(`Hello ${name}`); message(variable)',
      "example.ts",
    )
    expect(result.errors).toHaveLength(2)
  })

  test("leaves runtime error strings to fallback lookup", () => {
    const result = extractSourceMessages(
      'import { t } from "@alloy/i18n"; t(serverError)',
      "example.ts",
    )
    expect(result).toEqual({ messages: [], errors: [] })
  })
})

describe("catalog validation", () => {
  test("rejects missing, empty, and broken interpolation entries", () => {
    expect(
      validateCatalog(
        {
          Empty: " ",
          "Hello {name}": "Hallo {username}",
        },
        ["Missing", "Empty", "Hello {name}"],
      ),
    ).toEqual([
      'Missing translation: "Missing"',
      'Empty translation: "Empty"',
      'Placeholder mismatch: "Hello {name}"; expected ["name"], got ["username"]',
    ])
  })

  test("allows unchanged technical names and reordered or repeated placeholders", () => {
    expect(
      validateCatalog(
        {
          Webhooks: "Webhooks",
          "{first} {last}": "{last}, {first} ({first})",
        },
        ["Webhooks", "{first} {last}"],
      ),
    ).toEqual([])
  })

  test("preserves boundary whitespace in translated fragments", () => {
    expect(
      validateCatalog({ " and {name}": "und {name}" }, [" and {name}"]),
    ).toEqual(['Boundary whitespace mismatch: " and {name}"'])
  })
})
