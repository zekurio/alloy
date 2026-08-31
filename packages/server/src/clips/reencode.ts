import { clip } from "@alloy/db/schema"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { and, eq, isNull } from "drizzle-orm"

// The media worker only claims processing/ready clips, so an owner/admin
// re-encode must first clear terminal quarantine + stage columns and flip a
// failed clip back to processing. Guarded on the null run ID so a run that just
// took over isn't clobbered. Returns true when a failed clip was flipped.
export async function resetFailedClipForEncode(
  clipId: string,
  tx: DbTransaction,
): Promise<boolean> {
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
      ),
    )
    .returning({ id: clip.id })
  return Boolean(accepted)
}
