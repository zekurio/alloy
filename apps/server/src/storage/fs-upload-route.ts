import { createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import { Hono } from "hono"

import { decodeUploadToken, FsStorageDriver } from "./fs-driver"
import { getStorageConfig, getStorageDriver } from "./index"

export const storageRoute = new Hono().post("/upload/:token", async (c) => {
  const storage = getStorageDriver()
  const storageConfig = getStorageConfig()
  // Only the fs driver makes sense behind this route. S3 uploads go
  // directly to the object store via presigned URLs.
  if (!(storage instanceof FsStorageDriver) || storageConfig.driver !== "fs") {
    return c.json(
      { error: "Upload route is only valid for the fs storage driver" },
      500
    )
  }

  const token = c.req.param("token")
  const decoded = decodeUploadToken(token, storageConfig.fs.hmacSecret)
  if (!decoded.ok) {
    return c.json({ error: "Invalid upload ticket" }, 401)
  }
  const { k: key, ct: expectedContentType, mb: maxBytes } = decoded.payload

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

  const fullDst = storage.fullPath(key)
  const tmpDir = path.join(storage.fullPath(".tmp"), token.slice(-32))
  await fsp.mkdir(tmpDir, { recursive: true })
  await fsp.mkdir(path.dirname(fullDst), { recursive: true })
  const tmpFile = path.join(tmpDir, "blob")

  let bytesWritten = 0
  let limitTripped = false
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
    await fsp
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => undefined)
    if (limitTripped) {
      return c.json({ error: "Upload exceeded maximum size" }, 413)
    }
    // eslint-disable-next-line no-console
    console.error("[api/assets/upload] write failed:", err)
    return c.json({ error: "Upload write failed" }, 500)
  }

  try {
    await fsp.link(tmpFile, fullDst)
  } catch (err) {
    await fsp
      .rm(tmpDir, { recursive: true, force: true })
      .catch(() => undefined)
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return c.json({ error: "Upload ticket has already been used" }, 409)
    }
    // eslint-disable-next-line no-console
    console.error("[api/assets/upload] publish failed:", err)
    return c.json({ error: "Upload publish failed" }, 500)
  }
  await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)

  return c.body(null, 204)
})
