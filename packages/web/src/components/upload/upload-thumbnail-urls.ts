import { revokeObjectUrl } from "@/lib/object-url"

export function revokeUploadThumbUrl(
  url: string | null | undefined,
  label: string,
) {
  if (!url?.startsWith("blob:")) return
  revokeObjectUrl(url, label)
}
