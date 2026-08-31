import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { candidateUrls } from "./probe"

test("normalizes pasted server addresses before probing", () => {
  assert.deepEqual(candidateUrls(" alloy.example/api?source=desktop#login "), [
    "https://alloy.example",
  ])
  assert.deepEqual(candidateUrls("http://localhost:2552/api/"), [
    "http://localhost:2552",
  ])
  assert.deepEqual(candidateUrls("http://alloy.example"), [])
})
