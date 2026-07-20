import assert from "node:assert/strict"
import { test } from "node:test"

import {
  isDiscordWebhookUrl,
  isValidWebhookTemplate,
  renderWebhookTemplate,
} from "@alloy/contracts"

import { announceTemplateValues, discordAnnouncePayload } from "./deliver"

// The Discord announcement must stay a bare link with no embeds: providing
// any embed suppresses Discord's unfurler, which is the only way to get a
// playable video preview.
test("discordAnnouncePayload is the bare clip link", () => {
  const announcement = {
    clipUrl: "https://alloy.example/clips/6f1c2b1e",
    title: "Ace clutch",
    authorUsername: "zekurio",
    game: "CS2",
  }
  assert.deepEqual(discordAnnouncePayload(announcement), {
    content: "https://alloy.example/clips/6f1c2b1e",
  })
  assert.deepEqual(announceTemplateValues(announcement), {
    clipUrl: "https://alloy.example/clips/6f1c2b1e",
    title: "Ace clutch",
    author: "zekurio",
    game: "CS2",
  })
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
