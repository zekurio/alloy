import assert from "node:assert/strict"

import type { UploadTicket } from "@alloy/contracts"
import { test } from "vite-plus/test"

import { uploadTicketForRequestOrigin } from "./staged"

const ticket: UploadTicket = {
  uploadUrl: "https://canonical.example/api/assets/upload/signed?part=1",
  method: "PUT",
  headers: {},
  expiresAt: 1,
}

test("rebases filesystem upload tickets to the browser request origin", () => {
  assert.equal(
    uploadTicketForRequestOrigin(
      ticket,
      "https://lan-alias.example/api/clips/initiate",
    ).uploadUrl,
    "https://lan-alias.example/api/assets/upload/signed?part=1",
  )
})

test("preserves external storage upload tickets", () => {
  const external = {
    ...ticket,
    uploadUrl: "https://storage.example/uploads/signed?part=1",
  }
  assert.equal(
    uploadTicketForRequestOrigin(
      external,
      "https://lan-alias.example/api/clips/initiate",
    ),
    external,
  )
})
