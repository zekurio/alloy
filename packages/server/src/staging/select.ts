import { game, stagingRecording, userDevice } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { gameSelectShape, serialiseGameRow } from "@alloy/server/games/ref"
import { and, eq, sql } from "drizzle-orm"

/**
 * Owner-library projection of a staging recording. Mirrors the clip select
 * shape (minus engagement + privacy, plus kind) so the web editor/cards can
 * treat staging recordings and clips uniformly. `tags` is the denormalized
 * text[] column; the game join is LEFT (staging may have no game).
 */
export const stagingSelectShape = {
  id: stagingRecording.id,
  authorId: stagingRecording.authorId,
  kind: stagingRecording.kind,
  title: stagingRecording.title,
  description: stagingRecording.description,
  game: stagingRecording.game,
  steamgriddbId: stagingRecording.steamgriddbId,
  sourceKey: stagingRecording.sourceKey,
  sourceContentType: stagingRecording.sourceContentType,
  sourceVideoCodec: stagingRecording.sourceVideoCodec,
  sourceAudioCodec: stagingRecording.sourceAudioCodec,
  sourceSizeBytes: stagingRecording.sourceSizeBytes,
  durationMs: stagingRecording.durationMs,
  width: stagingRecording.width,
  height: stagingRecording.height,
  thumbKey: stagingRecording.thumbKey,
  thumbBlurHash: stagingRecording.thumbBlurHash,
  status: stagingRecording.status,
  encodeProgress: stagingRecording.encodeProgress,
  failureReason: stagingRecording.failureReason,
  tags: stagingRecording.tags,
  gameRef: gameSelectShape,
  originDeviceName: sql<
    string | null
  >`(select ${userDevice.name} from ${userDevice} where ${userDevice.id} = ${stagingRecording.originDeviceId})`,
  createdAt: stagingRecording.createdAt,
  updatedAt: stagingRecording.updatedAt,
} as const

type StagingSelectRow = {
  sourceKey: string | null
  thumbKey: string | null
  steamgriddbId: number | null
  game: string | null
  gameRef?: Parameters<typeof serialiseGameRow>[0] | null
}

export function toStagingRow<T extends StagingSelectRow>(row: T) {
  const { sourceKey: _sourceKey, gameRef, ...rest } = row
  const hasGame = gameRef != null && gameRef.steamgriddbId != null
  return {
    ...rest,
    gameRef: hasGame ? serialiseGameRow(gameRef) : null,
    thumbKey: row.thumbKey ? "thumbnail" : null,
  }
}

export async function selectStagingById(id: string, authorId: string) {
  const [row] = await db
    .select(stagingSelectShape)
    .from(stagingRecording)
    .leftJoin(game, eq(stagingRecording.steamgriddbId, game.steamgriddbId))
    .where(
      and(eq(stagingRecording.id, id), eq(stagingRecording.authorId, authorId)),
    )
    .limit(1)
  return row ?? null
}
