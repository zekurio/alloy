import { clip } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, eq, isNull } from "drizzle-orm"

// The encode handler no-ops on a failed clip, so a re-encode (owner/admin
// re-encode endpoint, or an admin job retry) must first clear the terminal
// quarantine + stage columns and flip the clip back to processing. Guarded on
// the null lease so a run that just took over isn't clobbered. Returns true
// when a failed clip was flipped; a clip not in failed status is left untouched
// and returns false so the caller can proceed without one.
export async function resetFailedClipForEncode(
  clipId: string,
): Promise<boolean> {
  const [accepted] = await db
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
