export * from "./clip"
export * from "./game"
export * from "./instance"
export * from "./recording"
export * from "./social"
export * from "./storage-deletion"
export * from "./webhook"

import { clip, clipMention, clipRendition, clipTag, clipView } from "./clip"
import { game, gameDetectionMapping } from "./game"
import { instanceSetting } from "./instance"
import { uploadTicket } from "./recording"
import { block } from "./social"
import { storageDeletion } from "./storage-deletion"
import { webhook, webhookDelivery } from "./webhook"

/**
 * Application (non-auth) tables. Combined with `authSchema` into `dbSchema`
 * for the drizzle client; auth tables live in `./auth`.
 */
export const domainSchema = {
  clip,
  clipRendition,
  uploadTicket,
  clipView,
  clipMention,
  clipTag,
  game,
  gameDetectionMapping,
  instanceSetting,
  block,
  storageDeletion,
  webhook,
  webhookDelivery,
} as const
