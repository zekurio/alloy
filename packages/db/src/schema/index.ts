export * from "./clip"
export * from "./game"
export * from "./scheduled-tasks"
export * from "./social"

import {
  clip,
  clipComment,
  clipCommentLike,
  clipLike,
  clipMention,
  clipTag,
  clipUploadTicket,
  clipView,
} from "./clip"
import { game, gameFollow } from "./game"
import { scheduledTaskLock, scheduledTaskRun } from "./scheduled-tasks"
import { block, follow, notification } from "./social"

/**
 * Application (non-auth) tables. Combined with `authSchema` into `dbSchema`
 * for the drizzle client; auth tables live in `./auth`.
 */
export const domainSchema = {
  clip,
  clipUploadTicket,
  clipLike,
  clipView,
  clipComment,
  clipCommentLike,
  clipMention,
  clipTag,
  follow,
  game,
  gameFollow,
  block,
  notification,
  scheduledTaskRun,
  scheduledTaskLock,
} as const
