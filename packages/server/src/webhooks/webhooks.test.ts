import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isDiscordWebhookUrl,
  isValidWebhookTemplate,
  renderWebhookTemplate,
} from "@alloy/contracts"

import { discordAnnouncePayload, type ClipAnnouncement } from "./deliver"

const BASE_ANNOUNCEMENT: ClipAnnouncement = {
  clipId: "6f1c2b1e-0000-4000-8000-000000000000",
  title: "Ace clutch",
  authorUsername: "zekurio",
  authorImage: null,
  authorDiscordId: null,
  game: null,
  durationMs: 30_000,
  hasThumbnail: false,
  createdAt: new Date("2025-01-01T00:00:00Z"),
}

test("discordAnnouncePayload mentions a linked Discord account without pinging", () => {
  const payload = discordAnnouncePayload({
    ...BASE_ANNOUNCEMENT,
    authorDiscordId: "80351110224678912",
  }) as { content?: string; allowed_mentions?: unknown }
  assert.equal(payload.content, "<@80351110224678912>")
  assert.deepEqual(payload.allowed_mentions, { parse: [] })
})

test("discordAnnouncePayload omits the mention when no account is linked", () => {
  const payload = discordAnnouncePayload(BASE_ANNOUNCEMENT) as {
    content?: string
    allowed_mentions?: unknown
  }
  assert.equal(payload.content, undefined)
  assert.equal(payload.allowed_mentions, undefined)
})

test("isDiscordWebhookUrl accepts canonical webhook URLs", () => {
  assert.equal(
    isDiscordWebhookUrl("https://discord.com/api/webhooks/123456/abc-DEF_ghi"),
    true,
  )
  assert.equal(
    isDiscordWebhookUrl(
      "https://discordapp.com/api/v10/webhooks/123456/abc-DEF_ghi",
    ),
    true,
  )
  assert.equal(
    isDiscordWebhookUrl("https://ptb.discord.com/api/webhooks/1/token"),
    true,
  )
})

test("isDiscordWebhookUrl rejects non-webhook URLs", () => {
  assert.equal(isDiscordWebhookUrl(""), false)
  assert.equal(isDiscordWebhookUrl("not a url"), false)
  assert.equal(
    isDiscordWebhookUrl("http://discord.com/api/webhooks/1/token"),
    false,
  )
  assert.equal(
    isDiscordWebhookUrl("https://evil.com/api/webhooks/1/token"),
    false,
  )
  assert.equal(isDiscordWebhookUrl("https://discord.com/api/webhooks/1"), false)
  assert.equal(
    isDiscordWebhookUrl("https://discord.com/api/webhooks/1/token/extra"),
    false,
  )
})

test("renderWebhookTemplate substitutes placeholders", () => {
  const rendered = renderWebhookTemplate(
    '{"content":"[author] published [title] ([game]) — [clip_url]"}',
    {
      clipUrl: "https://alloy.example/clips/abc",
      title: "Ace clutch",
      author: "zekurio",
      game: "CS2",
    },
  )
  assert.deepEqual(rendered, {
    content:
      "zekurio published Ace clutch (CS2) — https://alloy.example/clips/abc",
  })
})

test("renderWebhookTemplate escapes values for JSON string context", () => {
  const rendered = renderWebhookTemplate('{"content":"[title]"}', {
    clipUrl: "",
    title: 'quote " backslash \\ newline \n end',
    author: "",
    game: "",
  })
  assert.deepEqual(rendered, {
    content: 'quote " backslash \\ newline \n end',
  })
})

test("renderWebhookTemplate returns null for invalid JSON templates", () => {
  assert.equal(
    renderWebhookTemplate('{"content": [title]}', {
      clipUrl: "",
      title: "x",
      author: "",
      game: "",
    }),
    null,
  )
})

test("isValidWebhookTemplate validates the template shape", () => {
  assert.equal(isValidWebhookTemplate('{"content":"[title]"}'), true)
  assert.equal(isValidWebhookTemplate("{invalid"), false)
})
