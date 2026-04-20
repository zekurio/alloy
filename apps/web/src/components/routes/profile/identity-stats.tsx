import type { ProfileCounts } from "../../../lib/users-api"
import { StatInline } from "./stat-inline"

type IdentityStatsProps = {
  counts: ProfileCounts
}

export function IdentityStats({ counts }: IdentityStatsProps) {
  return (
    <div className="flex items-center gap-4 text-sm text-foreground-dim">
      <StatInline value={counts.clips} label="clips" />
      <span aria-hidden className="text-foreground-faint">
        ·
      </span>
      <StatInline value={counts.followers} label="followers" />
      <span aria-hidden className="text-foreground-faint">
        ·
      </span>
      <StatInline value={counts.following} label="following" />
    </div>
  )
}
