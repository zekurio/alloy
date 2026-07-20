import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@alloy/api/auth"
import { t } from "@alloy/i18n"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const USERNAME_MIN_LEN = USERNAME_MIN_LENGTH
const USERNAME_MAX_LEN = USERNAME_MAX_LENGTH
const USERNAME_DISALLOWED_RE = /[\s@\p{Cc}\p{Cs}/\\]/u
const DISPLAY_NAME_DISALLOWED_RE = /[\p{Cc}\p{Cs}]/u

export function validateRequiredString(
  value: string,
  label: string,
): string | undefined {
  return value.trim().length === 0
    ? t("{label} is required", { label })
    : undefined
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return t("Email is required")
  }

  if (!EMAIL_RE.test(trimmed)) {
    return t("Enter a valid email address")
  }

  return undefined
}

export function validateUsername(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length < USERNAME_MIN_LEN) {
    return t("Username can't be empty")
  }

  if (trimmed.length > USERNAME_MAX_LEN) {
    return t("Username can be at most {max} characters", {
      max: USERNAME_MAX_LEN,
    })
  }

  if (USERNAME_DISALLOWED_RE.test(trimmed)) {
    return t("Username can't contain spaces, @, slashes, or control characters")
  }

  return undefined
}

export function validateDisplayName(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length < DISPLAY_NAME_MIN_LENGTH) {
    return t("Display name can't be empty")
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return t("Display name can be at most {max} characters", {
      max: DISPLAY_NAME_MAX_LENGTH,
    })
  }
  if (DISPLAY_NAME_DISALLOWED_RE.test(trimmed)) {
    return t("Display name can't contain control characters")
  }
  return undefined
}
