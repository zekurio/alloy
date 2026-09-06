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

test("keeps HTTPS upload tickets secure behind an HTTP reverse proxy", () => {
  assert.equal(
    uploadTicketForRequestOrigin(
      ticket,
      "http://lan-alias.example/api/clips/initiate",
    ).uploadUrl,
    "https://lan-alias.example/api/assets/upload/signed?part=1",
  )
})

test("supports HTTP upload tickets for local development", () => {
  assert.equal(
    uploadTicketForRequestOrigin(
      {
        ...ticket,
        uploadUrl: "http://localhost:2552/api/assets/upload/signed",
      },
      "http://localhost:3000/api/clips/initiate",
    ).uploadUrl,
    "http://localhost:3000/api/assets/upload/signed",
  )
})
