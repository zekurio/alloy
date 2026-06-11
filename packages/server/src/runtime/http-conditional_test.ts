import { test } from "node:test"

import { ifNoneMatchSatisfied } from "./http-conditional"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("If-None-Match is not satisfied when the header is absent or empty", () => {
  assert(
    !ifNoneMatchSatisfied(undefined, '"x"'),
    "missing header should not match",
  )
  assert(!ifNoneMatchSatisfied("", '"x"'), "empty header should not match")
  assert(!ifNoneMatchSatisfied("   ", '"x"'), "blank header should not match")
})

test("If-None-Match matches exact ETags and comma-separated lists", () => {
  assert(ifNoneMatchSatisfied('"x"', '"x"'), "exact ETag should match")
  assert(
    ifNoneMatchSatisfied('"a", "x", "z"', '"x"'),
    "list member should match",
  )
  assert(
    !ifNoneMatchSatisfied('"a", "b", "z"', '"x"'),
    "missing ETag should not match",
  )
})

test("If-None-Match wildcard matches any current representation", () => {
  assert(ifNoneMatchSatisfied("*", '"x"'), "wildcard should match")
})

test("If-None-Match uses weak comparison for weak and strong tags", () => {
  assert(
    ifNoneMatchSatisfied('W/"x"', '"x"'),
    "weak request tag should match strong current tag",
  )
  assert(
    ifNoneMatchSatisfied('"x"', 'W/"x"'),
    "strong request tag should match weak current tag",
  )
  assert(
    ifNoneMatchSatisfied('W/"x"', 'W/"x"'),
    "weak request tag should match weak current tag",
  )
})
