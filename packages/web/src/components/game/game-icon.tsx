import {
  GameIcon as UiGameIcon,
  type GameIconProps,
} from "@alloy/ui/components/game-icon"

import { desktopCachedAssetUrl } from "@/lib/desktop"

/** Apply the desktop's constrained image cache before rendering game artwork. */
export function GameIcon({ src, ...props }: GameIconProps) {
  return <UiGameIcon {...props} src={desktopCachedAssetUrl(src ?? null)} />
}
