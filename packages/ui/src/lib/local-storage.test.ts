import assert from "node:assert/strict"

import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
import {
  DEFAULT_THEME_PREFERENCES,
  normalizeThemePreferences,
} from "@alloy/ui/lib/theme-storage"
import { test } from "vite-plus/test"

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()
  failWrites = false

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("write failed")
    this.#values.set(key, value)
  }
}

test("theme preferences retain valid fields and drop the rest", () => {
  assert.deepEqual(
    normalizeThemePreferences({
      mode: "dark",
      palette: "removed-palette",
      accents: {
        dark: "#abc",
        light: "not-a-color",
        removed: "#ffffff",
      },
      removed: true,
    }),
    {
      mode: "dark",
      palette: "default",
      accents: { dark: "#aabbcc" },
    },
  )
})

test("values outside the current object shape reset in memory", () => {
  assert.deepEqual(normalizeThemePreferences("dark"), DEFAULT_THEME_PREFERENCES)
})

test("writeback replaces only the current config value", () => {
  const storage = new MemoryStorage()
  storage.setItem(
    "alloy.theme",
    JSON.stringify({ mode: "light", palette: "nord", removed: true }),
  )
  storage.setItem("alloy.themeBackup", "unmanaged")
  storage.setItem("alloy.locale", "de")

  const driver = createLocalStorageDriver(
    "alloy.theme",
    normalizeThemePreferences,
    storage,
  )
  const preferences = driver.read()

  assert.equal(
    storage.getItem("alloy.theme"),
    JSON.stringify({ mode: "light", palette: "nord", removed: true }),
  )
  driver.write(preferences)

  assert.equal(
    storage.getItem("alloy.theme"),
    JSON.stringify({ mode: "light", palette: "nord", accents: {} }),
  )
  assert.equal(storage.getItem("alloy.themeBackup"), "unmanaged")
  assert.equal(storage.getItem("alloy.locale"), "de")
})

test("failed writes remain available for the browser session", () => {
  const storage = new MemoryStorage()
  const driver = createLocalStorageDriver(
    "alloy.theme",
    normalizeThemePreferences,
    storage,
  )
  storage.failWrites = true

  driver.write({ mode: "dark", palette: "one", accents: {} })

  assert.deepEqual(driver.read(), {
    mode: "dark",
    palette: "one",
    accents: {},
  })
})
