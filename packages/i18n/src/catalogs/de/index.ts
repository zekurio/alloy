import { mergeCatalogs } from "../catalog"
import { ACCOUNT_MESSAGES } from "./account"
import { ADMIN_MESSAGES } from "./admin"
import { COMMON_MESSAGES } from "./common"
import { DESKTOP_MESSAGES } from "./desktop"
import { ERRORS_MESSAGES } from "./errors"
import { MEDIA_MESSAGES } from "./media"
import { SETTINGS_MESSAGES } from "./settings"

export const DE_MESSAGES = mergeCatalogs(
  COMMON_MESSAGES,
  ACCOUNT_MESSAGES,
  SETTINGS_MESSAGES,
  MEDIA_MESSAGES,
  DESKTOP_MESSAGES,
  ADMIN_MESSAGES,
  ERRORS_MESSAGES,
)
