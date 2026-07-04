import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "rendition sweep postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("renditions-sweep")

  const { TranscodingConfigSchema } = await import("@alloy/contracts")
  const { user } = await import("@alloy/db/auth-schema")
  const { clip, clipRendition, instanceSetting, job } =
    await import("@alloy/db/schema")
  const { db, client } = await import("@alloy/server/db/index")
  const { encodeFingerprint, expectedLadder } =
    await import("@alloy/server/media/encode-fingerprint")
  const { MEDIA_PIPELINE_VERSION } =
    await import("@alloy/server/media/pipeline-version")
  const { getJobKind } = await import("../registry")
  await import("./clip-encode")
  await import("./renditions-sweep")
  const { eq, inArray } = await import("drizzle-orm")

  const config = TranscodingConfigSchema.parse({})

  interface TestFacts {
    height: number
    sourceFps: number | null
    sourceContentType: string | null
    sourceCodecs: string | null
    trimStartMs: number | null
    trimEndMs: number | null
  }

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(job)
    await db.delete(clip)
    await db.delete(user)
    await db.delete(instanceSetting)
  })

  test("stale mode skips current, quarantined, and unprobed clips", async () => {
    const current = await insertClip({
      encodeFingerprint: encodeFingerprint(config, defaultFacts()),
    })
    const stale = await insertClip({
      encodeFingerprint: encodeFingerprint(
        TranscodingConfigSchema.parse({ quality: 24 }),
        defaultFacts(),
      ),
    })
    const quarantined = await insertClip({
      encodeFailedFingerprint: encodeFingerprint(config, defaultFacts()),
    })
    const unprobed = await insertClip({
      facts: { ...defaultFacts(), sourceFps: null },
    })

    await runSweep("stale")

    const rows = await clipEncodeJobs()
    assert.deepEqual(
      rows.map((row) => row.dedupKey),
      [stale],
    )
    assert.equal(rows[0]?.priority, 90)
    assert.deepEqual(rows[0]?.payload, {
      clipId: stale,
      trigger: "sweep",
    })

    assert.equal((await selectSummary()).scanned, 4)
    assert.equal((await selectSummary()).upToDate, 1)
    assert.equal((await selectSummary()).enqueued, 1)
    assert.equal((await selectSummary()).quarantined, 1)
    assert.equal((await selectSummary()).unprobed, 1)
    assert.equal((await selectSummary()).adopted, 0)

    assert.ok(current)
    assert.ok(quarantined)
    assert.ok(unprobed)
  })

  test("adopt-in-place stamps matching legacy rows and fixes is_og", async () => {
    const matching = await insertClip({
      encodePipeline: MEDIA_PIPELINE_VERSION,
    })
    await insertExpectedRenditions(matching, defaultFacts())

    const wrongOg = await insertClip({ encodePipeline: MEDIA_PIPELINE_VERSION })
    await insertExpectedRenditions(wrongOg, defaultFacts(), {
      forceIsOg: false,
    })

    const legacy = await insertClip({ encodePipeline: "2" })
    await insertExpectedRenditions(legacy, defaultFacts())

    const empty = await insertClip({
      encodePipeline: MEDIA_PIPELINE_VERSION,
      facts: browserSafeEmptyFacts(),
    })

    await runSweep("stale")

    const rows = await db
      .select({
        id: clip.id,
        encodeFingerprint: clip.encode_fingerprint,
      })
      .from(clip)
      .where(inArray(clip.id, [matching, wrongOg, legacy, empty]))

    assert.equal(
      rows.find((row) => row.id === matching)?.encodeFingerprint,
      encodeFingerprint(config, defaultFacts()),
    )
    assert.equal(
      rows.find((row) => row.id === wrongOg)?.encodeFingerprint,
      encodeFingerprint(config, defaultFacts()),
    )
    assert.equal(rows.find((row) => row.id === legacy)?.encodeFingerprint, null)
    assert.equal(
      rows.find((row) => row.id === empty)?.encodeFingerprint,
      encodeFingerprint(config, browserSafeEmptyFacts()),
    )

    const fixed = await db
      .select({ name: clipRendition.name, isOg: clipRendition.is_og })
      .from(clipRendition)
      .where(eq(clipRendition.clip_id, wrongOg))
    assert.deepEqual(
      fixed.map((row) => ({ name: row.name, isOg: row.isOg })),
      expectedLadder(config, defaultFacts()).map((step) => ({
        name: step.name,
        isOg: step.og,
      })),
    )

    const jobs = await clipEncodeJobs()
    assert.deepEqual(
      jobs.map((row) => row.dedupKey),
      [legacy],
    )

    assert.equal((await selectSummary()).scanned, 4)
    assert.equal((await selectSummary()).adopted, 3)
    assert.equal((await selectSummary()).enqueued, 1)
  })

  test("adopt gate enqueues browser-safe clips with unexpected legacy renditions", async () => {
    const unexpected = await insertClip({
      encodePipeline: MEDIA_PIPELINE_VERSION,
      facts: browserSafeEmptyFacts(),
    })
    await insertLegacyRendition(unexpected)

    await runSweep("stale")

    const [updated] = await db
      .select({ encodeFingerprint: clip.encode_fingerprint })
      .from(clip)
      .where(eq(clip.id, unexpected))
      .limit(1)
    assert.equal(updated?.encodeFingerprint, null)

    const rows = await clipEncodeJobs()
    assert.deepEqual(
      rows.map((row) => row.dedupKey),
      [unexpected],
    )
    assert.deepEqual(rows[0]?.payload, {
      clipId: unexpected,
      trigger: "sweep",
    })
    assert.equal(rows[0]?.priority, 90)
    assert.equal((await selectSummary()).adopted, 0)
    assert.equal((await selectSummary()).enqueued, 1)
  })

  test("force mode enqueues even already matching clips", async () => {
    const current = await insertClip({
      encodeFingerprint: encodeFingerprint(config, defaultFacts()),
    })

    await runSweep("force")

    const rows = await clipEncodeJobs()
    assert.deepEqual(
      rows.map((row) => row.dedupKey),
      [current],
    )
    assert.deepEqual(rows[0]?.payload, {
      clipId: current,
      trigger: "reencode",
    })
    assert.equal(rows[0]?.priority, 90)
    assert.equal((await selectSummary()).scanned, 1)
    assert.equal((await selectSummary()).enqueued, 1)
    assert.equal((await selectSummary()).upToDate, 0)
  })

  async function runSweep(mode: "stale" | "force"): Promise<void> {
    const registration = getJobKind("clip.renditions-sweep")
    assert.ok(registration)
    await registration.handler({ mode }, contextFor())
  }

  async function insertClip(options: {
    encodeFingerprint?: string | null
    encodeFailedFingerprint?: string | null
    encodePipeline?: string | null
    facts?: TestFacts
  }): Promise<string> {
    const clipId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    await db.insert(user).values({
      id: userId,
      email: `${clipId}@example.test`,
      username: `user-${clipId.slice(0, 8)}`,
    })
    await db.insert(clip).values({
      id: clipId,
      author_id: userId,
      title: "Test clip",
      status: "ready",
      source_key: `source/${clipId}`,
      source_content_type: options.facts
        ? options.facts.sourceContentType
        : "video/webm",
      source_codecs: options.facts ? options.facts.sourceCodecs : null,
      source_fps: options.facts ? options.facts.sourceFps : 60,
      height: options.facts ? options.facts.height : 1080,
      trim_start_ms: options.facts ? options.facts.trimStartMs : null,
      trim_end_ms: options.facts ? options.facts.trimEndMs : null,
      encode_pipeline: options.encodePipeline ?? MEDIA_PIPELINE_VERSION,
      encode_fingerprint: options.encodeFingerprint ?? null,
      encode_failed_fingerprint: options.encodeFailedFingerprint ?? null,
      encode_progress: 100,
    })
    return clipId
  }

  async function insertExpectedRenditions(
    clipId: string,
    facts: TestFacts,
    options: { forceIsOg?: boolean } = {},
  ): Promise<void> {
    const ladder = expectedLadder(config, facts)
    if (ladder.length === 0) return
    await db.insert(clipRendition).values(
      ladder.map((step) => ({
        clip_id: clipId,
        name: step.name,
        is_og: options.forceIsOg ?? step.og,
        height: step.height,
        width: step.height * 2,
        fps: step.fps,
        storage_key: `rendition/${clipId}/${step.name}`,
        codecs: `${codecString(step.codec)},mp4a.40.2`,
        size_bytes: 1,
      })),
    )
  }

  async function insertLegacyRendition(clipId: string): Promise<void> {
    await db.insert(clipRendition).values({
      clip_id: clipId,
      name: "legacy",
      is_og: true,
      height: 720,
      width: 1280,
      fps: 60,
      storage_key: `rendition/${clipId}/legacy`,
      codecs: "avc1.64002a,mp4a.40.2",
      size_bytes: 1,
    })
  }

  async function clipEncodeJobs() {
    return db
      .select({
        dedupKey: job.dedup_key,
        priority: job.priority,
        payload: job.payload,
      })
      .from(job)
      .where(eq(job.kind, "clip.encode"))
      .orderBy(job.dedup_key)
  }

  async function selectSummary(): Promise<Record<string, unknown>> {
    const [row] = await db
      .select({ value: instanceSetting.value })
      .from(instanceSetting)
      .where(eq(instanceSetting.key, "renditionSweep"))
      .limit(1)
    assert.ok(row)
    return row.value as Record<string, unknown>
  }

  function defaultFacts() {
    return {
      height: 1080,
      sourceFps: 60,
      sourceContentType: "video/webm",
      sourceCodecs: null,
      trimStartMs: null,
      trimEndMs: null,
    }
  }

  function browserSafeEmptyFacts() {
    return {
      height: 360,
      sourceFps: 60,
      sourceContentType: "video/mp4",
      sourceCodecs: "avc1.64002A,mp4a.40.2",
      trimStartMs: null,
      trimEndMs: null,
    }
  }

  function codecString(codec: "h264" | "hevc" | "av1"): string {
    if (codec === "h264") return "avc1.64002a"
    if (codec === "hevc") return "hvc1.1.6.L123.B0"
    return "av01.0.08M.08"
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
