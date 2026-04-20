import * as React from "react"

import { toast } from "@workspace/ui/components/sonner"

import { isServerHttpError } from "./http-error"

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

    toast.error(title, {
      id: toastId,
      description: error.message,
    })
  }, [error, title, toastId])
}
