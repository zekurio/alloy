import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"

import { postWebhook, signWebhookBody } from "./send"

interface Received {
  headers: IncomingMessage["headers"]
  body: string
}

// A real loopback server rather than a stubbed fetch: the point of these tests
// is the bytes and headers that go on the wire, which a mock would only
// restate.
const received: Received[] = []
let status = 204
let responseBody = ""

const server: Server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on("data", (chunk: Buffer) => chunks.push(chunk))
  req.on("end", () => {
    received.push({
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    })
    res.writeHead(status)
    res.end(responseBody)
  })
})

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

after(() => new Promise<void>((resolve) => server.close(() => resolve())))

function reset(nextStatus = 204, nextBody = "") {
  received.length = 0
  status = nextStatus
  responseBody = nextBody
}

test("a generic delivery is signed over the exact bytes sent", async () => {
  reset()
  const payload = {
    event: "clip.published",
    clip: { title: 'a "quoted" clip' },
  }
  const result = await postWebhook(
    { provider: "generic", url: `${origin}/hook`, secret: "s3cret" },
    {
      deliveryId: "11111111-2222-3333-4444-555555555555",
      event: "clip.published",
      content: "ignored by generic",
      body: payload,
    },
  )

  assert.deepEqual(result, { ok: true, status: 204 })
  const [request] = received
  assert.ok(request)
  assert.equal(request.headers["x-alloy-event"], "clip.published")
  assert.equal(
    request.headers["x-alloy-delivery"],
    "11111111-2222-3333-4444-555555555555",
  )
  assert.deepEqual(JSON.parse(request.body), payload)
  // A receiver verifies against the raw body, so recomputing from the parsed
  // object must not be necessary — and must still agree.
  assert.equal(
    request.headers["x-alloy-signature"],
    `sha256=${createHmac("sha256", "s3cret").update(request.body).digest("hex")}`,
  )
})

test("a generic delivery without a secret carries no signature", async () => {
  reset()
  await postWebhook(
    { provider: "generic", url: `${origin}/hook`, secret: null },
    {
      deliveryId: "delivery",
      event: "clip.published",
      content: "",
      body: { ok: true },
    },
  )

  assert.equal(received[0]?.headers["x-alloy-signature"], undefined)
})

test("a Discord delivery posts the bare link as message content", async () => {
  reset()
  await postWebhook(
    { provider: "discord", url: `${origin}/api/webhooks/1/t`, secret: null },
    {
      deliveryId: "delivery",
      event: "clip.published",
      content: "https://alloy.test/clips/abc",
      body: { never: "sent to discord" },
    },
  )

  const [request] = received
  assert.ok(request)
  // The rich card comes from Discord unfurling the link against the clip
  // page's OpenGraph tags; a custom embed here could not play video.
  assert.deepEqual(JSON.parse(request.body), {
    content: "https://alloy.test/clips/abc",
  })
  // Signature headers are generic-only — Discord authenticates by URL token.
  assert.equal(request.headers["x-alloy-signature"], undefined)
  assert.equal(request.headers["x-alloy-event"], undefined)
})

test("a non-2xx response reports the status and a truncated body", async () => {
  reset(400, `{"message":"${"x".repeat(500)}"}`)
  const result = await postWebhook(
    { provider: "discord", url: `${origin}/api/webhooks/1/t`, secret: null },
    { deliveryId: "d", event: "clip.published", content: "hi", body: {} },
  )

  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
  assert.ok(result.error.startsWith("400: "))
  assert.ok(result.error.length < 250)
})

test("an unreachable endpoint reports a failure instead of throwing", async () => {
  reset()
  const result = await postWebhook(
    // Reserved by RFC 6761 for tests; never resolves.
    { provider: "generic", url: "https://webhook.invalid/hook", secret: null },
    { deliveryId: "d", event: "clip.published", content: "", body: {} },
  )

  assert.equal(result.ok, false)
  assert.equal(result.status, null)
  assert.ok(result.error.length > 0)
})

test("signWebhookBody is stable and keyed by the secret", () => {
  assert.equal(signWebhookBody("body", "a"), signWebhookBody("body", "a"))
  assert.notEqual(signWebhookBody("body", "a"), signWebhookBody("body", "b"))
  assert.match(signWebhookBody("body", "a"), /^sha256=[0-9a-f]{64}$/)
})
