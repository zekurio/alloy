import * as React from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { createMiddleware, createServerFn } from "@tanstack/react-start"

import {
  clipStreamUrl,
  clipThumbnailUrl,
  HttpError,
  type ClipEncodedVariant,
  type ClipRow,
} from "@workspace/api"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { api } from "@/lib/api"

const requestContextMiddleware = createMiddleware().server(
  ({ next, request }) => {
    return next({ context: { request } })
  }
)

const getPublicOrigin = createServerFn({ method: "GET" })
  .middleware([requestContextMiddleware])
  .handler(async ({ context }) => {
    return process.env.PUBLIC_APP_URL ?? new URL(context.request.url).origin
  })

const fetchRouteClipById = createServerFn({ method: "GET" })
  .middleware([requestContextMiddleware])
  .inputValidator((clipId: string) => clipId)
  .handler(async ({ data: clipId, context }) => {
    const cookie = context.request.headers.get("cookie")

    return api.clips.fetchById(
      clipId,
      cookie ? { headers: { cookie } } : undefined
    )
  })

export const Route = createFileRoute("/(app)/_app/g/$slug/c/$clipId")({
  loader: async ({ params }) => {
    try {
      const [clip, origin] = await Promise.all([
        fetchRouteClipById({ data: params.clipId }),
        getPublicOrigin(),
      ])
      return { clip, publicOrigin: origin }
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        throw redirect({
          to: "/g/$slug",
          params: { slug: params.slug },
          replace: true,
        })
      }
      throw error
    }
  },
  head: ({ loaderData }) =>
    clipHead(loaderData?.clip ?? null, loaderData?.publicOrigin),
  component: ClipModalRoute,
})

function clipHead(row: ClipRow | null, origin?: string) {
  if (!row || row.privacy === "private") {
    return { meta: [{ title: "alloy" }] }
  }

  const description =
    row.description?.trim() ||
    `${row.authorUsername} shared a ${row.gameRef?.name ?? row.game ?? "game"} clip on alloy.`
  const poster = row.thumbKey ? clipThumbnailUrl(row.id, origin) : null
  const ogVariant = selectOpenGraphVariant(row)
  const videoUrl = clipStreamUrl(row.id, ogVariant?.id ?? "encoded", origin)
  const width = ogVariant?.width ?? row.width
  const height = ogVariant?.height ?? row.height

  return {
    meta: [
      { title: `${row.title} | alloy` },
      { name: "description", content: description },
      { property: "og:site_name", content: "alloy" },
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

  React.useEffect(() => {
    setModalClipId(clipId)
  }, [clipId])

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

  const handleNavigate = React.useCallback(
    (entry: { id: string; gameSlug: string | null }) => {
      setModalClipId(entry.id)
      // Match the URL to the new clip so refreshes land on the right
      // page — fall back to the current slug when the entry is missing one.
      void router.navigate({
        to: "/g/$slug/c/$clipId",
        params: { slug: entry.gameSlug ?? slug, clipId: entry.id },
        replace: true,
      })
    },
    [router, slug]
  )

  return (
    <ClipViewerDialog
      clipId={modalClipId}
      onClose={handleClose}
      onNavigate={handleNavigate}
    />
  )
}
