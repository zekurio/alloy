import assert from "node:assert/strict"
import test from "node:test"

import { isDiscordWebhookUrl, maskWebhookUrl } from "./webhooks"

test("isDiscordWebhookUrl accepts the hosts Discord actually hands out", () => {
  for (const host of [
    "discord.com",
    "ptb.discord.com",
    "canary.discord.com",
    "discordapp.com",
  ]) {
    assert.equal(
      isDiscordWebhookUrl(`https://${host}/api/webhooks/1234567890/tok-en_1`),
      true,
      host,
    )
  }
  assert.equal(
    isDiscordWebhookUrl("https://discord.com/api/v10/webhooks/1234/token"),
    true,
  )
})

test("isDiscordWebhookUrl rejects near-misses", () => {
  for (const url of [
    // Plain http would send the token in the clear.
    "http://discord.com/api/webhooks/1234/token",
    // Lookalike host.
    "https://discord.com.evil.test/api/webhooks/1234/token",
    "https://example.com/api/webhooks/1234/token",
    // Missing or malformed path segments.
    "https://discord.com/api/webhooks/1234",
    "https://discord.com/api/webhooks/notanid/token",
    "https://discord.com/api/webhooks/1234/token/messages/5678",
    "not a url",
    "",
  ]) {
    assert.equal(isDiscordWebhookUrl(url), false, url)
  }
})

test("maskWebhookUrl hides the Discord token but keeps the webhook id", () => {
  assert.equal(
    maskWebhookUrl(
      "discord",
      "https://discord.com/api/webhooks/1234567890/s3cr3t-token",
    ),
    "https://discord.com/api/webhooks/1234567890/****",
  )
})

test("maskWebhookUrl leaves generic endpoints intact", () => {
  // The signing secret is the generic credential, not the URL, and an admin
  // needs to read the endpoint back to recognise it.
  assert.equal(
    maskWebhookUrl("generic", "https://example.test/hooks/alloy?x=1"),
    "https://example.test/hooks/alloy?x=1",
  )
})
