import { createHash } from "node:crypto"

import type { TranscodingConfig } from "@alloy/contracts"
import { safeParse, t } from "@alloy/contracts/schema"
import { instanceSetting } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { MEDIA_PIPELINE_VERSION } from "@alloy/server/media/pipeline-version"
import { eq } from "drizzle-orm"

const GENERATION_KEY = "mediaEncodeGeneration"
const FORCE_PENDING_KEY = "mediaEncodeForcePending"

const MediaGenerationSchema = t.object({
  generation: t.number().int().min(1),
  outputSignature: t.string().min(1),
  executionSignature: t.string().min(1),
  forceGeneration: t.number().int().nonnegative(),
  retryFailuresGeneration: t.number().int().nonnegative(),
  changedAt: t.string().datetime({ offset: true }),
})

export type MediaGeneration = Readonly<t.infer<typeof MediaGenerationSchema>>

type Executor = Pick<DbTransaction, "delete" | "insert" | "select" | "update">

export interface MediaConfigSignatures {
  outputSignature: string
  executionSignature: string
}

type SignatureValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SignatureArray
  | SignatureObject

interface SignatureArray extends ReadonlyArray<SignatureValue> {}

interface SignatureObject {
  readonly [key: string]: SignatureValue
}

export function mediaConfigSignatures(
  config: TranscodingConfig,
): MediaConfigSignatures {
  const output = {
    pipeline: MEDIA_PIPELINE_VERSION,
    videoCodec: config.videoCodec,
    quality: config.quality,
    audioBitrateKbps: config.audioBitrateKbps,
    tiers: config.tiers.map((tier) => ({
      height: tier.height,
      maxFps: tier.maxFps,
      maxrateKbps: tier.maxrateKbps,
      codec: tier.codec,
      og: tier.og,
    })),
  }
  return {
    outputSignature: signature(output),
    executionSignature: signature({
      ...output,
      hardwareAcceleration: config.hardwareAcceleration,
      vaapiDevice: config.vaapiDevice,
    }),
  }
}

export async function synchronizeMediaGeneration(
  config: TranscodingConfig,
  tx?: DbTransaction,
): Promise<MediaGeneration> {
  if (tx) return synchronizeWithExecutor(config, tx)
  return db.transaction((transaction) =>
    synchronizeWithExecutor(config, transaction),
  )
}

export async function readMediaGeneration(): Promise<MediaGeneration | null> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, GENERATION_KEY))
    .limit(1)
  const parsed = safeParse(MediaGenerationSchema, row?.value)
  return parsed.success ? Object.freeze(parsed.data) : null
}

export async function forceMediaGeneration(
  config: TranscodingConfig,
): Promise<MediaGeneration> {
  return db.transaction(async (tx) => {
    const current = await synchronizeWithExecutor(config, tx)
    return writeGeneration(tx, {
      ...current,
      generation: current.generation + 1,
      forceGeneration: current.generation + 1,
      changedAt: new Date().toISOString(),
    })
  })
}

async function synchronizeWithExecutor(
  config: TranscodingConfig,
  executor: Executor,
): Promise<MediaGeneration> {
  const signatures = mediaConfigSignatures(config)
  const initial: MediaGeneration = {
    generation: 1,
    ...signatures,
    forceGeneration: 0,
    retryFailuresGeneration: 0,
    changedAt: new Date().toISOString(),
  }
  await executor
    .insert(instanceSetting)
    .values({ key: GENERATION_KEY, value: initial, updated_at: new Date() })
    .onConflictDoNothing({ target: instanceSetting.key })

  const [storedRow] = await executor
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, GENERATION_KEY))
    .limit(1)
    .for("update")
  const parsed = safeParse(MediaGenerationSchema, storedRow?.value)
  let current = parsed.success ? parsed.data : initial

  if (
    current.outputSignature !== signatures.outputSignature ||
    current.executionSignature !== signatures.executionSignature
  ) {
    const generation = current.generation + 1
    current = await writeGeneration(executor, {
      ...current,
      ...signatures,
      generation,
      retryFailuresGeneration: generation,
      changedAt: new Date().toISOString(),
    })
  } else if (!parsed.success) {
    current = await writeGeneration(executor, initial)
  }

  const [forcePending] = await executor
    .delete(instanceSetting)
    .where(eq(instanceSetting.key, FORCE_PENDING_KEY))
    .returning({ key: instanceSetting.key })
  if (!forcePending) return current

  const generation = current.generation + 1
  return writeGeneration(executor, {
    ...current,
    generation,
    forceGeneration: generation,
    changedAt: new Date().toISOString(),
  })
}

async function writeGeneration(
  executor: Pick<Executor, "update">,
  value: MediaGeneration,
): Promise<MediaGeneration> {
  await executor
    .update(instanceSetting)
    .set({ value, updated_at: new Date() })
    .where(eq(instanceSetting.key, GENERATION_KEY))
  return Object.freeze(value)
}

function signature(value: SignatureValue): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24)
}
