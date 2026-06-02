import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@workspace/api/auth"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const USERNAME_MIN_LEN = USERNAME_MIN_LENGTH
const USERNAME_MAX_LEN = USERNAME_MAX_LENGTH
const USERNAME_DISALLOWED_RE = /[\p{Cc}\p{Cs}/\\]/u

export function validateRequiredString(
  value: string,
  label: string
): string | undefined {
  return value.trim().length === 0 ? `${label} is required` : undefined
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return "Email is required"
  }

  if (!EMAIL_RE.test(trimmed)) {
    return "Enter a valid email address"
  }

  return undefined
}

export function validateUsername(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length < USERNAME_MIN_LEN) {
    return "Username can't be empty"
  }

  if (trimmed.length > USERNAME_MAX_LEN) {
    return `Username can be at most ${USERNAME_MAX_LEN} characters`
  }

  if (USERNAME_DISALLOWED_RE.test(trimmed)) {
    return "Username can't contain slashes or control characters"
  }

  return undefined
}
