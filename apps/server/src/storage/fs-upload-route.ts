import { createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { Hono } from "hono"

import { env } from "../env"
import { decodeUploadToken, FsStorageDriver } from "./fs-driver"
import { storage } from "./index"

/**
 * Fs-driver companion route. Mounted in `app.ts` at `/storage` so the
 * full path is `POST /storage/upload/:token`. The token is the HMAC-
 * signed payload `{ k, ct, mb, exp, uid, cid }` that `mintUploadUrl()`
 * issued during `/api/clips/initiate`.
 *
 * Why not under `/api/clips/*`: this is driver-internal. An S3 driver
 * has no analog — the browser PUTs straight at the bucket. Keeping it
 * under `/storage` makes that distinction obvious and makes it trivial
 * to omit (or no-op) when we add the S3 driver.
 *
 * Auth model: token-only. The HMAC binds (clipId, userId, key, contentType,
 * maxBytes, expiry); a stolen ticket can only overwrite the source for
 * one specific reserved clip belonging to one specific user, and
 * `/finalize` then refuses to act on it because `authorId` mismatches
 * the requesting session. Browsers send large bodies more reliably
 * without cookies in flight, hence no session check here.
 *
 * Atomicity: bytes stream into `.tmp/<token>` and `fs.rename` into the
 * final key on success. A partial upload never becomes visible to the
 * encoder — the worker is allowed to assume `clip.storageKey` either
 * exists in full or doesn't exist at all. Single-use is enforced by
 * `wx` write flag on the rename target — a second upload with the same
 * token races into a `EEXIST` and is rejected.
 */

export const storageRoute = new Hono().post("/upload/:token", async (c) => {
  // The driver factory always returns a concrete class; only the fs
  // driver makes sense behind this route. Bail loudly if the env was
  // flipped to something else after this route was mounted — it would
  // be an obvious deploy bug, not a runtime user error.
  if (!(storage instanceof FsStorageDriver)) {
    return c.json(
      { error: "Upload route is only valid for the fs storage driver" },
      500
    )
  }

  const token = c.req.param("token")
  const decoded = decodeUploadToken(token, env.STORAGE_HMAC_SECRET)
  if (!decoded.ok) {
    // Don't tell the caller *why* — a debug-friendly 401 leaks just
    // enough to help an attacker grind. The structured `code` is for
    // our own logs.
    return c.json({ error: "Invalid upload ticket" }, 401)
  }
  const { k: key, ct: expectedContentType, mb: maxBytes } = decoded.payload

  // Defence-in-depth Content-Type check: the browser ought to send the
  // type baked into the ticket; if it doesn't, refuse rather than write
  // mismatched bytes. (We don't strictly need this — the encoder probes
  // the file regardless — but failing fast keeps debugging sane.)
  const contentType = c.req.header("content-type")
  if (contentType && contentType !== expectedContentType) {
    return c.json(
      { error: "Content-Type does not match the upload ticket" },
      400
    )
  }

  if (!c.req.raw.body) {
    return c.json({ error: "Empty upload body" }, 400)
  }

  // Stage under .tmp/ so the final key only appears once the upload has
  // fully landed. Per-token directory keeps concurrent retries from
  // colliding on the same temp file.
  const fullDst = storage.fullPath(key)
  const tmpDir = path.join(storage.fullPath(".tmp"), token.slice(-32))
  await fsp.mkdir(tmpDir, { recursive: true })
  await fsp.mkdir(path.dirname(fullDst), { recursive: true })
  const tmpFile = path.join(tmpDir, "blob")

  let bytesWritten = 0
  let limitTripped = false
  // Web ReadableStream → Node Readable so we can pipe() it. Counter
  // gates the byte budget — once we cross `maxBytes` we kill the stream
  // and respond 413 instead of letting the disk fill up.
  const nodeBody = Readable.fromWeb(
    c.req.raw.body as Parameters<typeof Readable.fromWeb>[0]
  )
  const counter = async function* (src: Readable) {
    for await (const chunk of src) {
      bytesWritten += (chunk as Buffer).byteLength
      if (bytesWritten > maxBytes) {
        limitTripped = true
        // Throwing aborts the pipeline; the catch below cleans up the
        // partial write and returns 413.
        throw new Error("upload exceeded maxBytes")
      }
      yield chunk
    }
  }

  try {
    await pipeline(nodeBody, counter, createWriteStream(tmpFile))
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if (limitTripped) {
      return c.json({ error: "Upload exceeded maximum size" }, 413)
    }
    // eslint-disable-next-line no-console
    console.error("[storage/upload] write failed:", err)
    return c.json({ error: "Upload write failed" }, 500)
  }

  // Atomic publish. `wx` flag → `rename` would clobber an existing file,
  // which we don't want; we go through a copy+unlink dance via link()
  // then rm() to enforce the single-use property without renaming over
  // an existing file.
  try {
    await fsp.link(tmpFile, fullDst)
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return c.json({ error: "Upload ticket has already been used" }, 409)
    }
    // eslint-disable-next-line no-console
    console.error("[storage/upload] publish failed:", err)
    return c.json({ error: "Upload publish failed" }, 500)
  }
  await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

  return c.body(null, 204)
})
