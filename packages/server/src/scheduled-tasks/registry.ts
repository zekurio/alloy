import {
  clipBlurHashBackfillTask,
  gameBlurHashBackfillTask,
} from "./blurhash-backfill"
import {
  clipOpenGraphMaintenanceTask,
  clipStorageCleanupTask,
} from "./clip-maintenance"

export const scheduledTasks = [
  clipStorageCleanupTask,
  clipOpenGraphMaintenanceTask,
  clipBlurHashBackfillTask,
  gameBlurHashBackfillTask,
]
