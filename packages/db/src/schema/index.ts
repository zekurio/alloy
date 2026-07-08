export * from "./clip"
export * from "./game"
export * from "./instance"
export * from "./job"
export * from "./notification"
export * from "./recording"
export * from "./social"

import {
  clip,
  clipComment,
  clipCommentMention,
  clipCommentLike,
  clipLike,
  clipMention,
  clipRendition,
  clipTag,
  clipView,
} from "./clip"
import { game, gameDetectionMapping, gameFollow } from "./game"
import { instanceSetting } from "./instance"
import { job } from "./job"
import { notification } from "./notification"
import { uploadTicket } from "./recording"
import { block, follow } from "./social"

/**
 * Application (non-auth) tables. Combined with `authSchema` into `dbSchema`
 * for the drizzle client; auth tables live in `./auth`.
 */
export const domainSchema = {
  clip,
  clipRendition,
  uploadTicket,
  clipLike,
  clipView,
  clipComment,
  clipCommentLike,
  clipMention,
  clipCommentMention,
  clipTag,
  follow,
  game,
  gameFollow,
  gameDetectionMapping,
  instanceSetting,
  job,
  notification,
  block,
} as const
