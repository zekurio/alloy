import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"

import { test } from "vite-plus/test"

import { sendWebhook } from "./send"

test("Discord edits tracked messages and only replaces missing messages", async () => {
  const requests: { method: string | undefined; url: string | undefined }[] = []
  let status = 200
  let editStatus = 200
  let editErrorCode = 10008
  let responseBody = JSON.stringify({
    id: "123456789012345678",
    content: "clip",
  })
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url })
    request.resume()
    const editing = request.method === "PATCH"
    response.writeHead(editing ? editStatus : status, {
      "content-type": "application/json",
    })
    response.end(
      editing && editStatus !== 200
        ? JSON.stringify({ code: editErrorCode })
        : responseBody,
    )
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
      await sendWebhook({ provider: "discord", url, secret: null }, message),
      { ok: true, status: 200, discordMessageId: "123456789012345678" },
    )
    assert.deepEqual(requests.at(-1), {
      method: "POST",
      url: "/api/webhooks/1/token?thread_id=42&wait=true",
    })

    const edit = { ...message, discordMessageId: "123456789012345678" }
    assert.deepEqual(
      await sendWebhook({ provider: "discord", url, secret: null }, edit),
      { ok: true, status: 200, discordMessageId: edit.discordMessageId },
    )
    assert.deepEqual(requests.at(-1), {
      method: "PATCH",
      url: "/api/webhooks/1/token/messages/123456789012345678?thread_id=42",
    })

    // Another destination edits its own message through its own webhook token.
    await sendWebhook(
      {
        provider: "discord",
        url: url.replace("/1/token", "/2/other-token"),
        secret: null,
      },
      { ...edit, discordMessageId: "987654321098765432" },
    )
    assert.deepEqual(requests.at(-1), {
      method: "PATCH",
      url: "/api/webhooks/2/other-token/messages/987654321098765432?thread_id=42",
    })

    editStatus = 404
    responseBody = JSON.stringify({ id: "111111111111111111" })
    assert.deepEqual(
      await sendWebhook({ provider: "discord", url, secret: null }, edit),
      { ok: true, status: 200, discordMessageId: "111111111111111111" },
    )
    assert.deepEqual(
      requests.slice(-2).map((request) => request.method),
      ["PATCH", "POST"],
    )

    // Missing webhooks and transient errors must not create replacement posts.
    for (const [failureStatus, errorCode] of [
      [404, 10015],
      [403, 50013],
      [429, 0],
      [500, 0],
    ]) {
      editStatus = failureStatus!
      editErrorCode = errorCode!
      const before = requests.length
      const result = await sendWebhook(
        { provider: "discord", url, secret: null },
        edit,
      )
      assert.equal(result.ok, false)
      assert.equal(result.status, failureStatus)
      assert.equal(requests.length, before + 1)
      assert.equal(requests.at(-1)?.method, "PATCH")
    }
    editStatus = 200

    status = 200
    for (const invalidBody of [
      "not JSON",
      JSON.stringify({ id: "../other" }),
    ]) {
      responseBody = invalidBody
      assert.deepEqual(
        await sendWebhook({ provider: "discord", url, secret: null }, edit),
        { ok: true, status: 200, discordMessageId: edit.discordMessageId },
      )
      // Don't retry an accepted post just because its response cannot be tracked.
      assert.deepEqual(
        await sendWebhook({ provider: "discord", url, secret: null }, message),
        { ok: true, status: 200 },
      )
    }

    status = 204
    responseBody = ""
    assert.deepEqual(
      await sendWebhook({ provider: "generic", url, secret: null }, edit),
      { ok: true, status: 204 },
    )
    assert.equal(requests.at(-1)?.method, "POST")
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
