import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, beforeEach, test } from "node:test"

const storageRoot = await mkdtemp(join(tmpdir(), "alloy-scrubber-ticket-"))
process.env.ALLOY_STORAGE_FS_CLIPS_PATH = join(storageRoot, "clips")
process.env.ALLOY_STORAGE_FS_THUMBNAILS_PATH = join(storageRoot, "thumbnails")
process.env.ALLOY_STORAGE_FS_ASSETS_PATH = join(storageRoot, "assets")

const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
await prepareTestDatabase("scrubber-ticket")

// Dynamic imports are required because these modules read DATABASE_URL and
// the storage paths at import time; the env assignments above must run first.
const { CLIP_SCRUBBER_SHEET_HEIGHT } = await import("@alloy/contracts")
const { user } = await import("@alloy/db/auth-schema")
const { clip, uploadTicket } = await import("@alloy/db/schema")
const { clipScrubberKey } = await import("@alloy/server/clips/scrubber")
const { promoteUploadedScrubber } =
  await import("@alloy/server/clips/scrubber-upload")
const { db, client } = await import("@alloy/server/db/index")
const { clipStorage, clipThumbnailStorage } =
  await import("@alloy/server/storage/index")
const { stagedScrubberKey, stagedSourceKey } =
  await import("@alloy/server/uploads/staged")
const {
  cleanupTickets,
  createUploadTickets,
  selectScrubberTicket,
  selectTicketKeys,
} = await import("@alloy/server/uploads/tickets")
const { eq } = await import("drizzle-orm")
const sharp = (await import("sharp")).default

after(async () => {
  await client.end()
  await rm(storageRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(uploadTicket)
  await db.delete(clip)
  await db.delete(user)
})

test("mints video and scrubber tickets for one target", async () => {
  const { clipId, scrubberKey, videoKey } = await seedTickets()

  const rows = await db.select().from(uploadTicket)
  assert.deepEqual(
    rows.map((row) => row.role).sort(),
    ["scrubber", "video"],
    "the role check constraint must accept the new scrubber role",
  )
  const scrubber = await selectScrubberTicket({ type: "clip", id: clipId })
  assert.equal(scrubber?.storageKey, scrubberKey)
  assert.equal(scrubber?.contentType, "image/jpeg")

  // The failure and completion sweeps both key off this, so it has to
  // return the scrubber alongside the source.
  assert.deepEqual(
    (await selectTicketKeys({ type: "clip", id: clipId }))
      .map((entry) => entry.key)
      .sort(),
    [scrubberKey, videoKey].sort(),
  )
})

test("promotes a well-formed sprite into the clip scrubber key", async () => {
  const { clipId, scrubberKey } = await seedTickets()
  const sprite = await spriteJpeg(684)
  await clipStorage.put(scrubberKey, sprite, "image/jpeg")
  await db
    .update(uploadTicket)
    .set({ expected_bytes: sprite.byteLength })
    .where(eq(uploadTicket.storage_key, scrubberKey))

  assert.equal(await promoteUploadedScrubber(clipId), true)

  const promoted = await clipThumbnailStorage.resolve(clipScrubberKey(clipId))
  assert.ok(promoted, "the encode pass keys its skip guard off this object")
  const metadata = await sharp(
    Buffer.from(await new Response(promoted.stream()).arrayBuffer()),
  ).metadata()
  assert.equal(metadata.height, CLIP_SCRUBBER_SHEET_HEIGHT)
})

test("ignores a scrubber whose ticket already expired", async () => {
  const { clipId, scrubberKey } = await seedTickets()
  const sprite = await spriteJpeg(684)
  await clipStorage.put(scrubberKey, sprite, "image/jpeg")
  await db
    .update(uploadTicket)
    .set({
      expected_bytes: sprite.byteLength,
      expires_at: new Date(Date.now() - 1000),
    })
    .where(eq(uploadTicket.storage_key, scrubberKey))

  assert.equal(await promoteUploadedScrubber(clipId), false)
  assert.equal(
    await clipThumbnailStorage.resolve(clipScrubberKey(clipId)),
    null,
  )
})

test("ignores a scrubber that does not match the declared size", async () => {
  const { clipId, scrubberKey } = await seedTickets()
  await clipStorage.put(scrubberKey, await spriteJpeg(684), "image/jpeg")

  // seedTickets declares 4096 bytes; the stored sprite is a different size.
  assert.equal(await promoteUploadedScrubber(clipId), false)
  assert.equal(
    await clipThumbnailStorage.resolve(clipScrubberKey(clipId)),
    null,
  )
})

test("cleanupTickets sweeps the staged scrubber and both rows", async () => {
  const { clipId, scrubberKey, videoKey } = await seedTickets()
  await clipStorage.put(scrubberKey, await spriteJpeg(684), "image/jpeg")
  await clipStorage.put(videoKey, new Uint8Array([1, 2, 3]), "video/mp4")

  await cleanupTickets({ type: "clip", id: clipId }, "test")

  assert.equal(await clipStorage.resolve(scrubberKey), null)
  assert.equal(await clipStorage.resolve(videoKey), null)
  assert.deepEqual(await db.select().from(uploadTicket), [])
})

function spriteJpeg(width: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height: CLIP_SCRUBBER_SHEET_HEIGHT,
      channels: 3,
      background: { r: 40, g: 120, b: 220 },
    },
  })
    .jpeg()
    .toBuffer()
}

async function seedTickets() {
  const ownerId = crypto.randomUUID()
  await db.insert(user).values({
    id: ownerId,
    email: `${ownerId}@example.test`,
    username: `owner-${ownerId.slice(0, 8)}`,
  })
  const clipId = crypto.randomUUID()
  await db.insert(clip).values({
    id: clipId,
    author_id: ownerId,
    title: "clip",
    status: "pending",
  })
  const videoKey = stagedSourceKey(clipId, "video/mp4")
  const scrubberKey = stagedScrubberKey(clipId)
  await createUploadTickets({
    target: { type: "clip", id: clipId },
    ownerId,
    videoKey,
    videoContentType: "video/mp4",
    videoBytes: 1024,
    scrubber: { key: scrubberKey, bytes: 4096 },
    expiresAt: new Date(Date.now() + 60_000),
  })
  return { clipId, ownerId, scrubberKey, videoKey }
}
