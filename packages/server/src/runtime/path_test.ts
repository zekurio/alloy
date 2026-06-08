import assert from "node:assert/strict"
import test from "node:test"

import { dirname, isAbsolute, normalize, resolve } from "./path"

test("isAbsolute accepts POSIX, Windows drive, and Windows slash variants", () => {
  assert.equal(isAbsolute("/var/lib/alloy"), true)
  assert.equal(isAbsolute("C:/Users/zekurio/Git/alloy/data"), true)
  assert.equal(isAbsolute("C:\\Users\\zekurio\\Git\\alloy\\data"), true)
  assert.equal(isAbsolute("\\\\nas\\alloy\\data"), true)
  assert.equal(isAbsolute("data/clips"), false)
})

test("normalize keeps Windows drive roots while using stable separators", () => {
  assert.equal(
    normalize("C:\\Users\\zekurio\\Git\\alloy\\packages\\server\\..\\..\\data"),
    "C:/Users/zekurio/Git/alloy/data",
  )
})

test("normalize keeps Windows UNC roots while using stable separators", () => {
  assert.equal(
    normalize("\\\\nas\\alloy\\data\\..\\clips"),
    "//nas/alloy/clips",
  )
})

test("resolve does not prefix cwd segments before a Windows absolute path", () => {
  assert.equal(
    resolve(
      "C:/Users/zekurio/Git/alloy/packages/server",
      "C:/Users/zekurio/Git/alloy/data",
    ),
    "C:/Users/zekurio/Git/alloy/data",
  )
})

test("dirname handles normalized Windows absolute paths", () => {
  assert.equal(
    dirname("C:/Users/zekurio/Git/alloy/data/secrets.json"),
    "C:/Users/zekurio/Git/alloy/data",
  )
})
