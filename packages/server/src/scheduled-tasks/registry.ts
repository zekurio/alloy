import { gameBlurHashBackfillTask } from "./blurhash-backfill"
import { clipStorageCleanupTask } from "./clip-maintenance"

export const scheduledTasks = [clipStorageCleanupTask, gameBlurHashBackfillTask]
