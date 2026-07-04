import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "clip media store postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("clip-media-store")

  const { clip } = await import("@alloy/db/schema")
  const { user } = await import("@alloy/db/auth-schema")
  const { db, client } = await import("@alloy/server/db/index")
  const { clipMediaStore } =
    await import("@alloy/server/queue/clip-media-store")
  const { eq, sql } = await import("drizzle-orm")

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(clip)
    await db.delete(user)
  })

  test("commitStage ignores stale run ids", async () => {
    const row = await insertClip({ encodeRunId: crypto.randomUUID() })

    const committed = await clipMediaStore.commitStage(
      row.clipId,
      crypto.randomUUID(),
      "encoding",
      { name: "720p", index: 1, count: 2 },
    )

    const [updated] = await db
      .select({
        encodeStage: clip.encode_stage,
        encodeTier: clip.encode_tier,
        encodeTierIndex: clip.encode_tier_index,
        encodeTierCount: clip.encode_tier_count,
      })
      .from(clip)
      .where(eq(clip.id, row.clipId))
      .limit(1)

    assert.equal(committed, false)
    assert.deepEqual(updated, {
      encodeStage: null,
      encodeTier: null,
      encodeTierIndex: null,
      encodeTierCount: null,
    })
  })

  test("commitReady clears stage labels", async () => {
    const row = await insertClip({ encodeRunId: crypto.randomUUID() })

    assert.equal(
      await clipMediaStore.commitStage(
        row.clipId,
        row.encodeRunId,
        "encoding",
        {
          name: "720p",
          index: 1,
          count: 1,
        },
      ),
      true,
    )
    assert.equal(
      await clipMediaStore.commitReady(
        row.clipId,
        row.encodeRunId,
        {
          sourceKey: `source/${row.clipId}`,
          sourceContentType: "video/mp4",
          sourceVideoCodec: "h264",
          sourceAudioCodec: "aac",
          sourceCodecs: "avc1.640028,mp4a.40.2",
          sourceFps: 60,
          sourceSizeBytes: 1024,
          sourceDurationMs: 1000,
          cutKey: null,
          durationMs: 1000,
          width: 1280,
          height: 720,
          thumbKey: null,
          thumbBlurHash: null,
          encodeFingerprint: "fingerprint",
        },
        [],
      ),
      true,
    )

    const [updated] = await db
      .select({
        status: clip.status,
        encodeProgress: clip.encode_progress,
        encodeRunId: clip.encode_run_id,
        encodeStage: clip.encode_stage,
        encodeTier: clip.encode_tier,
        encodeTierIndex: clip.encode_tier_index,
        encodeTierCount: clip.encode_tier_count,
      })
      .from(clip)
      .where(eq(clip.id, row.clipId))
      .limit(1)

    assert.deepEqual(updated, {
      status: "ready",
      encodeProgress: 100,
      encodeRunId: null,
      encodeStage: null,
      encodeTier: null,
      encodeTierIndex: null,
      encodeTierCount: null,
    })
  })

  async function insertClip(options: {
    encodeRunId: string
  }): Promise<{ clipId: string; encodeRunId: string }> {
    const userId = crypto.randomUUID()
    const clipId = crypto.randomUUID()
    await db.insert(user).values({
      id: userId,
      email: `${clipId}@example.test`,
      username: `user-${clipId.slice(0, 8)}`,
    })
    await db.insert(clip).values({
      id: clipId,
      author_id: userId,
      title: "Test clip",
      status: "processing",
      encode_run_id: options.encodeRunId,
      encode_locked_at: sql`now()`,
    })
    return { clipId, encodeRunId: options.encodeRunId }
  }
}
