import assert from "node:assert/strict"
import test from "node:test"

import { withPageHead } from "./web-page-head"

test("withPageHead replaces generic metadata instead of duplicating it", () => {
  const shell = `<head>
<!-- alloy:head:start -->
<title>alloy</title>
<meta property="og:title" content="alloy" />
<link rel="apple-touch-icon" href="/logo.png" />
<!-- alloy:head:end -->
<link rel="icon" href="/logo.png" />
</head>`
  const clipHead = `<title>Clip | alloy</title>
<meta property="og:title" content="author" />`

  const html = withPageHead(shell, clipHead)

  assert.match(html, /<title>Clip \| alloy<\/title>/)
  assert.match(html, /<meta property="og:title" content="author" \/>/)
  assert.doesNotMatch(html, /<title>alloy<\/title>/)
  assert.doesNotMatch(html, /<meta property="og:title" content="alloy" \/>/)
  assert.doesNotMatch(html, /rel="apple-touch-icon" href="\/logo.png"/)
  assert.match(html, /rel="icon" href="\/logo.png"/)
})

test("withPageHead leaves the generic shell unchanged without route metadata", () => {
  const shell = "<html><!-- alloy:head:start --><!-- alloy:head:end --></html>"
  assert.equal(withPageHead(shell, ""), shell)
})

test("withPageHead rejects a shell without the metadata region", () => {
  assert.throws(
    () => withPageHead("<html></html>", "<title>Clip</title>"),
    /missing page head markers/,
  )
})
