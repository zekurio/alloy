const RETRY_BACKOFF_MS = 30_000
export const WEBHOOK_MAX_ATTEMPTS = 5

/** Match the former job retry policy: five attempts, with linear backoff. */
export function webhookFailurePlan(
  previousAttempts: number,
  attemptedAt: Date,
) {
  const attempts = previousAttempts + 1
  const terminal = attempts >= WEBHOOK_MAX_ATTEMPTS
  return {
    attempts,
    terminal,
    nextAttemptAt: terminal
      ? attemptedAt
      : new Date(attemptedAt.getTime() + RETRY_BACKOFF_MS * attempts),
  }
}
