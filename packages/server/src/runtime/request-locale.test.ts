import assert from "node:assert/strict"

import { Hono } from "hono"
import { test } from "vitest"

import { requestLocale } from "./request-locale"

test("server-rendered pages follow the browser's language ranking", async () => {
  const app = new Hono().get("/", (c) => c.text(requestLocale(c)))
  const localeFor = async (acceptLanguage?: string) => {
    const headers = acceptLanguage
      ? { "accept-language": acceptLanguage }
      : undefined
    return (await app.request("http://localhost/", { headers })).text()
  }

  assert.equal(await localeFor("de-DE,de;q=0.9,en;q=0.8"), "de")
  assert.equal(await localeFor("en-GB;q=0.4,de;q=0.9"), "de")
  assert.equal(await localeFor("fr-FR,de;q=0.7"), "de")
  assert.equal(await localeFor("fr-FR"), "en")
  assert.equal(await localeFor("de;q=0"), "en")
  assert.equal(await localeFor(undefined), "en")
})
