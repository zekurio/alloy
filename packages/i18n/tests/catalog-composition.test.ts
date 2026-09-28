import { describe, expect, test } from "vitest"

import { mergeCatalogs } from "../src/catalogs/catalog"

describe("catalog composition", () => {
  test("combines feature messages without changing keys, values, or input catalogs", () => {
    const common = Object.freeze({ Save: "Speichern" })
    const account = Object.freeze({
      " and {count} {label}": " und {count} {label}",
      'Delete "{name}"?': "„{name}“ löschen?",
    })
    expect(mergeCatalogs(common, account)).toEqual({
      ...common,
      ...account,
    })
    expect(Object.keys(common)).toEqual(["Save"])
    expect(Object.keys(account)).toEqual([
      " and {count} {label}",
      'Delete "{name}"?',
    ])
  })

  test.each(["Speichern", "Sichern"])(
    "rejects duplicate keys when the second translation is %s",
    (secondTranslation) => {
      expect(() =>
        mergeCatalogs({ Save: "Speichern" }, { Save: secondTranslation }),
      ).toThrow('Duplicate translation key: "Save"')
    },
  )

  test("accepts empty feature catalogs", () => {
    expect(mergeCatalogs()).toEqual({})
    expect(mergeCatalogs({}, { Save: "Speichern" }, {})).toEqual({
      Save: "Speichern",
    })
  })

  test("handles keys matching Object prototype properties as ordinary messages", () => {
    const specialKeys = Object.fromEntries([
      ["__proto__", "Prototyp"],
      ["constructor", "Konstruktor"],
      ["toString", "Als Text"],
    ])
    const merged = mergeCatalogs(specialKeys)
    expect(Object.entries(merged)).toEqual(Object.entries(specialKeys))
    expect(() => mergeCatalogs(specialKeys, specialKeys)).toThrow(
      'Duplicate translation key: "__proto__"',
    )
  })
})
