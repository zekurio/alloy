import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@alloy/api/auth"
import { t as tx } from "@alloy/i18n"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const USERNAME_MIN_LEN = USERNAME_MIN_LENGTH
const USERNAME_MAX_LEN = USERNAME_MAX_LENGTH
const USERNAME_DISALLOWED_RE = /[\p{Cc}\p{Cs}/\\]/u

export function validateRequiredString(
  value: string,
  label: string,
): string | undefined {
  return value.trim().length === 0
    ? tx("{label} is required", { label })
    : undefined
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return tx("Email is required")
  }

  if (!EMAIL_RE.test(trimmed)) {
    return tx("Enter a valid email address")
  }

  return undefined
}

export function validateUsername(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length < USERNAME_MIN_LEN) {
    return tx("Username can't be empty")
  }

  if (trimmed.length > USERNAME_MAX_LEN) {
    return tx("Username can be at most {max} characters", {
      max: USERNAME_MAX_LEN,
    })
  }

  if (USERNAME_DISALLOWED_RE.test(trimmed)) {
    return tx("Username can't contain slashes or control characters")
  }

  return undefined
}
