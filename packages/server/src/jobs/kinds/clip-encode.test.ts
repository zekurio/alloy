import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "clip encode postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("clip-encode")

  const { clip, job } = await import("@alloy/db/schema")
  const { user } = await import("@alloy/db/auth-schema")
  const { db, client } = await import("@alloy/server/db/index")
  const { clipMediaStore } =
    await import("@alloy/server/queue/clip-media-store")
  const { encodeFingerprint } =
    await import("@alloy/server/media/encode-fingerprint")
  const { TranscodingConfigSchema } = await import("@alloy/contracts")
  const { ENCODE_LEASE_STALE_MS } =
    await import("@alloy/server/queue/lease-conditions")
  const { getJobKind } = await import("../registry")
  const store = await import("../store")
  await import("./clip-encode")
  await import("./maintenance")
  const { eq, sql } = await import("drizzle-orm")

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(job)
    await db.delete(clip)
    await db.delete(user)
  })

  test("fresh clip lease snoozes the job without consuming an attempt", async () => {
    const row = await insertClip({ status: "processing" })
    const activeRunId = crypto.randomUUID()
    // Seed via DB now() — JS Dates skew by the server timezone offset on
    // timestamp-without-tz columns and would read as an already-stale lease.
    const [seeded] = await db
      .update(clip)
      .set({ encode_run_id: activeRunId, encode_locked_at: sql`now()` })
      .where(eq(clip.id, row.clipId))
      .returning({ lockedAt: clip.encode_locked_at })
    assert.ok(seeded?.lockedAt)
    const lockedAt = seeded.lockedAt

    const id = await store.enqueue(
      "clip.encode",
      { clipId: row.clipId, trigger: "upload" },
      { dedupKey: row.clipId, priority: 10 },
    )
    const claimed = await store.claim(["clip.encode"], crypto.randomUUID())
    assert.ok(claimed)

    const registration = getJobKind("clip.encode")
    assert.ok(registration)
    await registration.handler(claimed.payload, {
      signal: new AbortController().signal,
      attempt: claimed.attempt,
      jobId: claimed.id,
      runId: claimed.lease_token ?? "",
      setProgress() {},
    })

    const [updated] = await db
      .select({
        status: job.status,
        attempt: job.attempt,
        runAt: job.run_at,
      })
      .from(job)
      .where(eq(job.id, id))
      .limit(1)

    assert.equal(updated?.status, "pending")
    assert.equal(updated?.attempt, 0)
    assert.ok(
      updated?.runAt.getTime() &&
        updated.runAt.getTime() >= lockedAt.getTime() + ENCODE_LEASE_STALE_MS,
    )
  })

  test("markFailed ignores stale run ids", async () => {
    const row = await insertClip({
      status: "processing",
      encodeRunId: crypto.randomUUID(),
    })

    await clipMediaStore.markFailed(
      row.clipId,
      crypto.randomUUID(),
      "boom",
      "fingerprint",
    )

    const [updated] = await db
      .select({
        status: clip.status,
        encodeRunId: clip.encode_run_id,
        failureReason: clip.failure_reason,
      })
      .from(clip)
      .where(eq(clip.id, row.clipId))
      .limit(1)

    assert.equal(updated?.status, "processing")
    assert.equal(updated?.encodeRunId, row.encodeRunId)
    assert.equal(updated?.failureReason, null)
  })

  test("matching sweep fingerprint finishes without taking a clip lease", async () => {
    const facts = {
      height: 1080,
      sourceFps: 60,
      sourceContentType: "video/mp4",
      sourceCodecs: "avc1.64002A,mp4a.40.2",
      trimStartMs: null,
      trimEndMs: null,
    }
    const row = await insertClip({
      status: "ready",
      encodeFingerprint: encodeFingerprint(
        TranscodingConfigSchema.parse({}),
        facts,
      ),
      facts,
    })
    const registration = getJobKind("clip.encode")
    assert.ok(registration)

    await registration.handler(
      { clipId: row.clipId, trigger: "sweep" },
      contextFor(),
    )

    const [updated] = await db
      .select({
        status: clip.status,
        encodeAttempt: clip.encode_attempt,
        encodeRunId: clip.encode_run_id,
      })
      .from(clip)
      .where(eq(clip.id, row.clipId))
      .limit(1)

    assert.equal(updated?.status, "ready")
    assert.equal(updated?.encodeAttempt, 0)
    assert.equal(updated?.encodeRunId, null)
  })

  test("matching sweep fingerprint with permanent thumbnail failure skips without taking a clip lease", async () => {
    const facts = {
      height: 1080,
      sourceFps: 60,
      sourceContentType: "video/mp4",
      sourceCodecs: "avc1.64002A,mp4a.40.2",
      trimStartMs: null,
      trimEndMs: null,
    }
    const row = await insertClip({
      status: "ready",
      encodeFingerprint: encodeFingerprint(
        TranscodingConfigSchema.parse({}),
        facts,
      ),
      facts,
      thumbKey: null,
      thumbFailedAt: new Date(),
    })
    const registration = getJobKind("clip.encode")
    assert.ok(registration)

    await registration.handler(
      { clipId: row.clipId, trigger: "sweep" },
      contextFor(),
    )

    const [updated] = await db
      .select({
        status: clip.status,
        encodeAttempt: clip.encode_attempt,
        encodeRunId: clip.encode_run_id,
      })
      .from(clip)
      .where(eq(clip.id, row.clipId))
      .limit(1)

    assert.equal(updated?.status, "ready")
    assert.equal(updated?.encodeAttempt, 0)
    assert.equal(updated?.encodeRunId, null)
  })

  test("admin retry of a failed clip.encode job flips the clip to processing", async () => {
    const row = await insertClip({ status: "processing" })
    const id = await store.enqueue(
      "clip.encode",
      { clipId: row.clipId, trigger: "upload" },
      { dedupKey: row.clipId },
    )
    const claimed = await store.claim(["clip.encode"], crypto.randomUUID())
    // Terminal (non-retryable) failure, then quarantine the clip as the encode
    // handler's onFailed path would.
    await store.fail(id, claimed?.lease_token ?? "", "boom", false)
    await db
      .update(clip)
      .set({
        status: "failed",
        failure_reason: "boom",
        encode_failed_fingerprint: "fingerprint",
        encode_progress: 42,
      })
      .where(eq(clip.id, row.clipId))

    assert.equal(await store.retry(id), true)

    const [job_row] = await db
      .select({ status: job.status, attempt: job.attempt })
      .from(job)
      .where(eq(job.id, id))
      .limit(1)
    assert.equal(job_row?.status, "pending")
    assert.equal(job_row?.attempt, 0)

    const [updated] = await db
      .select({
        status: clip.status,
        failureReason: clip.failure_reason,
        failedFingerprint: clip.encode_failed_fingerprint,
        encodeProgress: clip.encode_progress,
      })
      .from(clip)
      .where(eq(clip.id, row.clipId))
      .limit(1)
    assert.equal(updated?.status, "processing")
    assert.equal(updated?.failureReason, null)
    assert.equal(updated?.failedFingerprint, null)
    assert.equal(updated?.encodeProgress, 0)
  })

  test("clip.reconcile enqueues one encode job for a stuck clip", async () => {
    const row = await insertClip({ status: "processing" })
    const registration = getJobKind("clip.reconcile")
    assert.ok(registration)

    await registration.handler({}, contextFor())
    await registration.handler({}, contextFor())

    const rows = await db
      .select({
        kind: job.kind,
        payload: job.payload,
        priority: job.priority,
        dedupKey: job.dedup_key,
      })
      .from(job)
      .where(eq(job.kind, "clip.encode"))

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.priority, 70)
    assert.equal(rows[0]?.dedupKey, row.clipId)
    assert.deepEqual(rows[0]?.payload, {
      clipId: row.clipId,
      trigger: "reconcile",
    })
  })

  async function insertClip(options: {
    status: "processing" | "ready"
    encodeRunId?: string
    encodeFingerprint?: string
    facts?: {
      height: number
      sourceFps: number
      sourceContentType: string | null
      sourceCodecs: string | null
      trimStartMs: number | null
      trimEndMs: number | null
    }
    thumbKey?: string | null
    thumbFailedAt?: Date | null
  }): Promise<{ clipId: string; encodeRunId: string | null }> {
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
      status: options.status,
      source_key: options.facts ? `source/${clipId}` : null,
      // Ready clips need a thumbnail: the fingerprint skip treats a
      // thumb-less ready clip as incomplete and re-runs the encode.
      thumb_key:
        options.thumbKey === undefined
          ? options.status === "ready"
            ? `thumb/${clipId}`
            : null
          : options.thumbKey,
      thumb_failed_at: options.thumbFailedAt ?? null,
      source_content_type: options.facts?.sourceContentType ?? null,
      source_codecs: options.facts?.sourceCodecs ?? null,
      source_fps: options.facts?.sourceFps ?? null,
      height: options.facts?.height ?? null,
      trim_start_ms: options.facts?.trimStartMs ?? null,
      trim_end_ms: options.facts?.trimEndMs ?? null,
      encode_fingerprint: options.encodeFingerprint ?? null,
      encode_run_id: options.encodeRunId ?? null,
      encode_locked_at: options.encodeRunId ? sql`now()` : null,
    })
    return { clipId, encodeRunId: options.encodeRunId ?? null }
  }

  function contextFor() {
    return {
      signal: new AbortController().signal,
      attempt: 1,
      jobId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      setProgress() {},
    }
  }
}
