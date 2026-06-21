import { isServerHttpError } from "@alloy/api"
import { toast } from "@alloy/ui/lib/toast"
import { useEffect, useRef } from "react"

type UseQueryErrorToastOptions = {
  title: string
  toastId: string
}

export function useQueryErrorToast(
  error: Error | null | undefined,
  { title, toastId }: UseQueryErrorToastOptions,
) {
  const lastToastKey = useRef<string | null>(null)

  useEffect(() => {
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
