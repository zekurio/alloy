import { locks } from "node:worker_threads"

export function withGameAssetMutation<T>(
  gameId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return locks.request(`game-asset:${gameId.toLowerCase()}`, operation)
}
