import type { QueueClip } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { api } from "./api"
import { clipKeys } from "./clip-query-keys"
import { errorMessage } from "./error-message"

export function useDismissQueueClipMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.clips.dismissQueue(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<QueueClip[]>(clipKeys.queue(), (rows) =>
        rows?.filter(
          (row) =>
            row.id !== id ||
            row.status === "pending" ||
            row.status === "processing" ||
            row.encodeActive,
        ),
      )
    },
    onError: (cause) => {
      toast.error(errorMessage(cause, t("Couldn't remove from queue")))
    },
  })
}
