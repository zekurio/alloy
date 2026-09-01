import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DESKTOP_BRIDGE_CONTRACT_IDS,
  SERVER_INFO_PRODUCT,
  SERVER_INFO_SCHEMA,
  ServerInfoSchema,
} from "@alloy/contracts"
import { SERVER_HTTP_CONTRACT_1_FIXTURE } from "@alloy/contracts/server-http-fixtures"
import { test } from "vite-plus/test"

test("serves server info publicly when browse auth is enabled", async () => {
  // Production mode skips the workspace .env file, whose numeric values are
  // intended for the devenv wrapper rather than direct process.env parsing.
  process.env.NODE_ENV = "production"
  process.env.DATABASE_URL = "postgres://localhost/alloy-test"
  process.env.PUBLIC_SERVER_URL = "https://alloy.example"
  process.env.TRUSTED_ORIGINS = "https://alloy.example"
  const webDistDir = await mkdtemp(join(tmpdir(), "alloy-server-info-"))
  await writeFile(join(webDistDir, "index.html"), "<!doctype html>")
  process.env.WEB_DIST_DIR = webDistDir
  delete process.env.PORT
  delete process.env.ALLOY_UPLOAD_TTL_SEC
  delete process.env.ALLOY_OAUTH_AVATAR_ALLOW_PRIVATE_URLS
  delete process.env.ALLOY_DEFAULT_STORAGE_QUOTA_BYTES
  delete process.env.ALLOY_TRANSCODE_CONCURRENCY
  delete process.env.ALLOY_TRANSCODE_THREADS
  process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
  process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)
  process.env.ALLOY_REQUIRE_AUTH_TO_BROWSE = "true"

  try {
    const { app } = await import("./app")
    const response = await app.fetch(
      new Request("http://localhost/api/server-info"),
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    const csp =
      response.headers.get("Content-Security-Policy-Report-Only") ?? ""
    assert.match(csp, /alloy-asset:/)
    assert.match(csp, /alloy-capture:/)
    const body = ServerInfoSchema.parse(await response.json())
    assert.equal(body.schema, SERVER_INFO_SCHEMA)
    assert.equal(body.product, SERVER_INFO_PRODUCT)
    assert.ok(body.version.length > 0)
    assert.deepEqual(body.desktopBridgeContracts, DESKTOP_BRIDGE_CONTRACT_IDS)
    assert.deepEqual(
      {
        schema: body.schema,
        product: body.product,
        httpContracts: body.httpContracts,
        capabilities: body.capabilities,
      },
      {
        schema: SERVER_HTTP_CONTRACT_1_FIXTURE.schema,
        product: SERVER_HTTP_CONTRACT_1_FIXTURE.product,
        httpContracts: SERVER_HTTP_CONTRACT_1_FIXTURE.httpContracts,
        capabilities: SERVER_HTTP_CONTRACT_1_FIXTURE.capabilities,
      },
    )
  } finally {
    await rm(webDistDir, { recursive: true, force: true })
  }
})
