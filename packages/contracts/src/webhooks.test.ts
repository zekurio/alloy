import assert from "node:assert/strict"

import { test } from "vitest"

import {
  isDiscordWebhookUrl,
  isFluxerWebhookUrl,
  maskWebhookUrl,
} from "./webhooks"

test("message webhook URLs accept their supported deployment paths", () => {
  assert.equal(
    isDiscordWebhookUrl("https://discord.com/api/webhooks/123/token"),
    true,
  )
  assert.equal(
    isDiscordWebhookUrl("https://chat.example.com/api/webhooks/123/token"),
    false,
  )

  for (const url of [
    "https://api.fluxer.app/webhooks/123/token",
    "https://api.fluxer.app/v1/webhooks/123/token",
    "https://chat.example.com/api/webhooks/123/token",
    "https://chat.example.com/api/v1/webhooks/123/token",
  ]) {
    assert.equal(isFluxerWebhookUrl(url), true, url)
  }
  for (const url of [
    "http://chat.example.com/api/webhooks/123/token",
    "https://chat.example.com/api/webhooks/not-an-id/token",
    "https://chat.example.com/api/webhooks/123",
    "https://chat.example.com/hooks/123/token",
  ]) {
    assert.equal(isFluxerWebhookUrl(url), false, url)
  }
})

test("message webhook tokens are masked for admin responses", () => {
  assert.equal(
    maskWebhookUrl(
      "fluxer",
      "https://chat.example.com/api/webhooks/123/secret-token",
    ),
    "https://chat.example.com/api/webhooks/123/****",
  )
  assert.equal(
    maskWebhookUrl("generic", "https://example.com/hooks/secret-token"),
    "https://example.com/hooks/secret-token",
  )
})
