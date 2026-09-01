import assert from "node:assert/strict"

import { afterEach, test } from "vite-plus/test"

import {
  consumeCurrentQueryParam,
  currentUrlWithQueryParam,
  currentUrlWithoutSearchOrHash,
} from "./browser-url"

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow)
  else Reflect.deleteProperty(globalThis, "window")
})

test("builds share URLs from the current server route", () => {
  installWindow("https://clips.example.test/games/halo/clips/clip-1?view=grid")

  assert.equal(
    currentUrlWithoutSearchOrHash(),
    "https://clips.example.test/games/halo/clips/clip-1",
  )
  assert.equal(
    currentUrlWithQueryParam("comment", "comment-1"),
    "https://clips.example.test/games/halo/clips/clip-1?view=grid&comment=comment-1",
  )
})

test("keeps the current browser route in an OAuth callback URL", () => {
  installWindow("https://clips.example.test/?settings=security&tab=profile")

  assert.equal(
    currentUrlWithQueryParam("oauthLinked", "1"),
    "https://clips.example.test/?settings=security&tab=profile&oauthLinked=1",
  )
})

test("consumes a route query on the current server document", () => {
  let replaced = ""
  installWindow(
    "https://clips.example.test/settings?oauth_linked=1&tab=profile",
    (url) => {
      replaced = url
    },
  )
  assert.equal(consumeCurrentQueryParam("oauth_linked"), "1")
  assert.equal(replaced, "/settings?tab=profile")
})

function installWindow(href: string, replace?: (url: string) => void): void {
  const url = new URL(href)
  const value = {
    location: { href, hash: url.hash },
    history: {
      length: 1,
      back() {},
      replaceState(
        _data: null,
        _unused: string,
        nextUrl?: string | URL | null,
      ) {
        replace?.(String(nextUrl ?? ""))
      },
    },
  }
  // SAFETY: These helpers use only the location and history members above.
  Object.defineProperty(globalThis, "window", { configurable: true, value })
}
