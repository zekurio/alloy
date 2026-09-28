import { describe, expect, it } from "vitest"

import {
  searchSettingsCategories,
  settingsSearchCategories,
} from "./settings-search"

const german = settingsSearchCategories("de")

function matches(query: string, categories = german) {
  return searchSettingsCategories(categories, query)
}

describe("settings search", () => {
  it("matches translated category names and descriptions", () => {
    expect(
      matches("  GeFaHrEnZoNe  ").map(({ category }) => category.id),
    ).toEqual(["account"])
    expect(
      matches("spielerkennung").map(({ category }) => category.id),
    ).toContain("desktop")
  })

  it("matches translated option names and displays translated hints", () => {
    expect(matches(" BILDRATE ")).toEqual([
      {
        category: german.find(({ id }) => id === "desktop-quality"),
        hint: "Bildrate",
      },
    ])
    expect(matches("verknuepfte   konten")).toEqual([
      {
        category: german.find(({ id }) => id === "profile"),
        hint: "Verknüpfte Konten",
      },
    ])
    expect(matches("AUFLOESUNG")[0]?.hint).toBe("Auflösung")
  })

  it("keeps English option names and technical aliases searchable", () => {
    expect(matches("capture")[0]?.category.id).toBe("desktop")
    expect(matches("capture")[0]?.hint).toBeNull()
    expect(matches("frame rate")[0]?.category.id).toBe("desktop-quality")
    expect(matches("frame rate")[0]?.hint).toBe("Bildrate")
    expect(matches("connected accounts")[0]?.hint).toBe("Verknüpfte Konten")
    expect(matches("save hotkey")[0]?.hint).toBe("Clip-Tastenkürzel")
    expect(matches("free space")[0]?.hint).toBe("Festplattennutzung")
    expect(matches("nvenc")[0]?.category.id).toBe("transcoding")
    expect(matches("oauth").map(({ category }) => category.id)).toEqual([
      "profile",
      "authentication",
    ])
  })

  it.each([
    ["Profilbild", "profile"],
    ["Sprache", "preferences"],
    ["Lautstärke", "desktop-audio"],
    ["Ausgabegeräte", "desktop-audio"],
    ["Lautsprecher", "desktop-audio"],
    ["Aufnahmeordner", "desktop"],
    ["Tastenkürzel", "desktop"],
    ["Hardware-Beschleunigung", "transcoding"],
    ["Speicherkontingent", "users"],
    ["Weichzeichnen", "appearance"],
    ["Symbol", "games"],
    ["Signatur-Secret", "webhooks"],
  ])("finds %s among the controls in %s", (query, id) => {
    expect(matches(query).map(({ category }) => category.id)).toContain(id)
  })

  it("uses the supplied locale for each search catalog", () => {
    const english = settingsSearchCategories("en")
    expect(matches("frame rate", english)[0]?.hint).toBe("Frame rate")
    expect(matches("frame rate")[0]?.hint).toBe("Bildrate")
  })

  it("returns only supplied visible categories, in their given order", () => {
    const visible = german.filter(({ group }) => group === "account")
    expect(matches("nvenc", visible)).toEqual([])
    expect(
      matches("oauth", visible).map(({ category }) => category.id),
    ).toEqual(["profile"])
    expect(matches("  ", visible)).toEqual(
      visible.map((category) => ({ category, hint: null })),
    )
    expect(matches("nothing-could-match", visible)).toEqual([])
  })
})
