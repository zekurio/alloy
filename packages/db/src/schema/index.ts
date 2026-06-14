export * from "./clip"
export * from "./device"
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
import { gameSession, userDevice } from "./device"
import { game, gameFollow } from "./game"
import { instanceSetting } from "./instance"
import { stagingRecording, uploadTicket } from "./recording"
import { block, follow, notification } from "./social"

/**
 * Application (non-auth) tables. Combined with `authSchema` into `dbSchema`
 * for the drizzle client; auth tables live in `./auth`.
 */
export const domainSchema = {
  clip,
  uploadTicket,
  stagingRecording,
  clipLike,
  clipView,
  clipComment,
  clipCommentLike,
  clipMention,
  clipTag,
  follow,
  game,
  gameFollow,
  gameSession,
  userDevice,
  instanceSetting,
  block,
  notification,
} as const
