import * as React from "react"
import { createFileRoute, useRouter } from "@tanstack/react-router"

import { ClipPlayerModal } from "../../components/clip-player-modal"
import {
  clipStreamUrl,
  clipThumbnailUrl,
  fetchClipById,
  type ClipEncodedVariant,
  type ClipRow,
} from "../../lib/clips-api"

export const Route = createFileRoute("/(app)/_app/g/$slug/c/$clipId")({
  loader: async ({ params }) => {
    try {
      return { clip: await fetchClipById(params.clipId) }
    } catch {
      return { clip: null }
    }
  },
  head: ({ loaderData }) => clipHead(loaderData?.clip ?? null),
  component: ClipModalRoute,
})

function clipHead(row: ClipRow | null) {
  if (!row) {
    return { meta: [{ title: "Alloy" }] }
  }

  const description =
    row.description?.trim() ||
    `${row.authorUsername} shared a ${row.gameRef?.name ?? row.game ?? "game"} clip on Alloy.`
  const poster = row.thumbKey ? clipThumbnailUrl(row.id) : null
  const ogVariant = selectOpenGraphVariant(row)
  const videoUrl = clipStreamUrl(row.id, ogVariant?.id ?? "encoded")
  const width = ogVariant?.width ?? row.width
  const height = ogVariant?.height ?? row.height

  return {
    meta: [
      { title: `${row.title} | Alloy` },
      { name: "description", content: description },
      { property: "og:site_name", content: "Alloy" },
      { property: "og:type", content: "video.other" },
      { property: "og:title", content: row.title },
      { property: "og:description", content: description },
      ...(poster ? [{ property: "og:image", content: poster }] : []),
      { property: "og:video", content: videoUrl },
      { property: "og:video:url", content: videoUrl },
      ...(videoUrl.startsWith("https:")
        ? [{ property: "og:video:secure_url", content: videoUrl }]
        : []),
      { property: "og:video:type", content: "video/mp4" },
      ...(width
        ? [{ property: "og:video:width", content: String(width) }]
        : []),
      ...(height
        ? [{ property: "og:video:height", content: String(height) }]
        : []),
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: row.title },
      { name: "twitter:description", content: description },
      ...(poster ? [{ name: "twitter:image", content: poster }] : []),
    ],
  }
}

function selectOpenGraphVariant(row: ClipRow): ClipEncodedVariant | null {
  const mp4Variants = row.variants.filter(
    (variant) => variant.id !== "source" && variant.contentType === "video/mp4"
  )
  return (
    mp4Variants.find((variant) => variant.isDefault) ?? mp4Variants[0] ?? null
  )
}

function ClipModalRoute() {
  const { slug, clipId } = Route.useParams()
  const router = useRouter()
  const [modalClipId, setModalClipId] = React.useState<string | null>(clipId)

  const handleClose = React.useCallback(() => {
    setModalClipId(null)
    // Prefer browser back so the previous screen (if any) is preserved
    // verbatim. Cold loads fall through to the game page.
    if (router.history.length > 1) {
      router.history.back()
    } else {
      void router.navigate({
        to: "/g/$slug",
        params: { slug },
        replace: true,
      })
    }
  }, [router, slug])

  return <ClipPlayerModal clipId={modalClipId} onClose={handleClose} />
}
