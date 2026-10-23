import { createAuthExpiryWorker } from "./expiry-worker"

// Lookups already ignore expired sessions, so pruning only bounds table
// growth. A new session's deadline is 90 days out, never earlier than one the
// worker already waits for, so sign-in does not need to wake it.
const worker = createAuthExpiryWorker({
  table: "auth_session",
  reconciliationIntervalMs: 60 * 60 * 1000,
})

export function startAuthSessionExpiryWorker(): void {
  worker.start()
}

export function stopAuthSessionExpiryWorker(): Promise<void> {
  return worker.stop()
}
