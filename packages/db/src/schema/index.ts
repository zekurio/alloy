export * from "./clip"
export * from "./game"
export * from "./instance"
export * from "./recording"
export * from "./social"

import {
  clip,
  clipComment,
  clipCommentLike,
  clipLike,
  clipMention,
  clipTag,
  clipView,
} from "./clip"
import { game, gameDetectionMapping, gameFollow } from "./game"
import { instanceSetting } from "./instance"
import { uploadTicket } from "./recording"
import { block, follow } from "./social"

/**
 * Application (non-auth) tables. Combined with `authSchema` into `dbSchema`
 * for the drizzle client; auth tables live in `./auth`.
 */
export const domainSchema = {
  clip,
  uploadTicket,
  clipLike,
  clipView,
  clipComment,
  clipCommentLike,
  clipMention,
  clipTag,
  follow,
  game,
  gameFollow,
  gameDetectionMapping,
  instanceSetting,
  block,
} as const
