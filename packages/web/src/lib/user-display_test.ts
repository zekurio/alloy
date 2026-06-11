import { test } from "node:test"

import { displayName, userAvatar } from "./user-display"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("userAvatar derives initials from the stable username", () => {
  const full = userAvatar({
    id: "user-1",
    username: "zed",
    email: "alice@example.com",
  })
  const partial = userAvatar({
    id: "user-1",
    username: "zed",
  })

  assert(
    displayName({ username: "zed", email: "alice@example.com" }) === "@zed",
    "display name should prefer username over email",
  )
  assert(full.initials === "ZE", "full response should use username initials")
  assert(
    partial.initials === "ZE",
    "partial response should use the same initials",
  )
})

test("userAvatar strips display username sigils from initials", () => {
  const avatar = userAvatar({
    id: "user-2",
    displayUsername: "@stream_friend",
  })

  assert(avatar.initials === "SF", "display username initials should ignore @")
})
