import * as React from "react"

import { isServerHttpError } from "@workspace/api"
import { toast } from "@workspace/ui/lib/toast"

type UseQueryErrorToastOptions = {
  title: string
  toastId: string
}

export function useQueryErrorToast(
  error: Error | null | undefined,
  { title, toastId }: UseQueryErrorToastOptions
) {
  const lastToastKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!isServerHttpError(error)) {
      if (!error) lastToastKey.current = null
      return
    }

    const toastKey = `${toastId}:${error.status}:${error.message}`
    if (lastToastKey.current === toastKey) return
    lastToastKey.current = toastKey

    toast.error(title, { id: toastId })
  }, [error, title, toastId])
}
