import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"

import { test } from "vite-plus/test"

import { deleteDiscordWebhookMessage, postWebhook } from "./send"

test("Discord sends return a message ID and deletion preserves thread routing", async () => {
  const requests: { method: string | undefined; url: string | undefined }[] = []
  let status = 200
  let responseBody = JSON.stringify({
    id: "123456789012345678",
    content: "clip",
  })
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url })
    request.resume()
    response.writeHead(status, { "content-type": "application/json" })
    response.end(responseBody)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    assert.ok(address instanceof Object)
    const url = `http://127.0.0.1:${address.port}/api/webhooks/1/token?thread_id=42&wait=false`
    const message = {
      deliveryId: "delivery",
      event: "clip.published" as const,
      content: "clip",
      body: { clip: "clip" },
    }
    assert.deepEqual(
      await postWebhook({ provider: "discord", url, secret: null }, message),
      { ok: true, status: 200, discordMessageId: "123456789012345678" },
    )
    assert.deepEqual(requests.at(-1), {
      method: "POST",
      url: "/api/webhooks/1/token?thread_id=42&wait=true",
    })

    status = 204
    responseBody = ""
    assert.equal(
      await deleteDiscordWebhookMessage(url, "123456789012345678"),
      true,
    )
    assert.deepEqual(requests.at(-1), {
      method: "DELETE",
      url: "/api/webhooks/1/token/messages/123456789012345678?thread_id=42",
    })
    status = 404
    assert.equal(
      await deleteDiscordWebhookMessage(url, "123456789012345678"),
      true,
    )
    status = 429
    assert.equal(
      await deleteDiscordWebhookMessage(url, "123456789012345678"),
      false,
    )

    status = 200
    for (const invalidBody of [
      "not JSON",
      JSON.stringify({ id: "../other" }),
    ]) {
      responseBody = invalidBody
      // Don't retry an accepted post just because its response cannot be tracked.
      assert.deepEqual(
        await postWebhook({ provider: "discord", url, secret: null }, message),
        { ok: true, status: 200 },
      )
    }

    status = 204
    responseBody = ""
    assert.deepEqual(
      await postWebhook({ provider: "generic", url, secret: null }, message),
      { ok: true, status: 204 },
    )
    assert.equal(
      requests.at(-1)?.url,
      "/api/webhooks/1/token?thread_id=42&wait=false",
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
