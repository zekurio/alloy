import { clip } from "@alloy/db/schema"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { clipOwnsUpload } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, sql } from "drizzle-orm"

export type ResetFailedClipResult =
  | { ok: true }
  | { ok: false; reason: "active-work" | "no-media" | "missing" }

// The media worker only claims processing/ready clips, so an owner/admin
// re-encode must first clear terminal quarantine + stage columns and flip a
// failed clip back to processing. Guarded on the null run ID so a run that just
// took over isn't clobbered, and on media to encode from: a committed source or
// the upload a failed run kept. The UPDATE's condition is the authority; when it
// refuses, the row is read in the same transaction to tell the caller why.
export async function resetFailedClipForEncode(
  clipId: string,
  tx: DbTransaction,
): Promise<ResetFailedClipResult> {
  const hasMedia = sql<boolean>`(${clip.source_key} is not null or ${clipOwnsUpload()})`
  const [accepted] = await tx
    .update(clip)
    .set({
      status: "processing",
      encode_progress: 0,
      encode_attempt: 0,
      encode_stage: null,
      encode_tier: null,
      encode_tier_index: null,
      encode_tier_count: null,
      failure_reason: null,
      encode_failed_fingerprint: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(clip.id, clipId),
        eq(clip.status, "failed"),
        isNull(clip.encode_run_id),
        hasMedia,
      ),
    )
    .returning({ id: clip.id })
  if (accepted) return { ok: true }

  const [row] = await tx
    .select({ status: clip.status, hasMedia })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  if (!row) return { ok: false, reason: "missing" }
  return row.status === "failed" && !row.hasMedia
    ? { ok: false, reason: "no-media" }
    : { ok: false, reason: "active-work" }
}
