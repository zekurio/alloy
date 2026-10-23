import { createAuthExpiryWorker } from "./expiry-worker"

const worker = createAuthExpiryWorker({
  table: "auth_challenge",
  reconciliationIntervalMs: 10 * 60 * 1000,
})

export function startAuthChallengeExpiryWorker(): void {
  worker.start()
}

export function wakeAuthChallengeExpiryWorker(): void {
  worker.wake()
}

export function stopAuthChallengeExpiryWorker(): Promise<void> {
  return worker.stop()
}
