import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { test } from "vitest"

import { withInjectedHead } from "./web-html"

test("clip metadata replaces site defaults while ordinary pages keep them", async () => {
  const template = await readFile(
    new URL("../../web/index.html", import.meta.url),
    "utf8",
  )
  const head = [
    "<title>A $& clip | alloy</title>",
    '<meta property="og:title" content="A $& clip" />',
    '<meta property="og:description" content="Valorant" />',
  ].join("\n")
  const html = withInjectedHead(template, head)

  assert.ok(html.includes(head))
  assert.equal(html.match(/<title>/g)?.length, 1)
  assert.equal(html.match(/property="og:title"/g)?.length, 1)
  assert.equal(html.match(/property="og:description"/g)?.length, 1)
  assert.ok(!html.includes('property="og:site_name"'))
  assert.ok(!html.includes("Share and watch game clips on alloy."))
  assert.ok(html.includes('<div id="root"></div>'))
  assert.equal(withInjectedHead(template, ""), template)
})
