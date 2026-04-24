import * as React from "react"
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"

import { AppShell } from "@workspace/ui/components/app-shell"

import { AppSearchProvider } from "@/components/search/app-search"
import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { UploadFlow, UploadFlowProvider } from "@/components/upload/upload-flow"
import { requireBrowseAuthBeforeLoad } from "@/lib/auth-guards"
import { useBrowseAuthGate } from "@/lib/auth-hooks"

interface AppSearch {
  clip?: string
}

export const Route = createFileRoute("/(app)/_app")({
  beforeLoad: requireBrowseAuthBeforeLoad,
  validateSearch: (search: Record<string, unknown>): AppSearch => {
    const clip = search.clip
    return typeof clip === "string" && clip.length > 0 ? { clip } : {}
  },
  component: AppLayout,
})

function AppLayout() {
  const { allowed } = useBrowseAuthGate()
  const { clip } = Route.useSearch()
  const navigate = useNavigate()

  const handleCloseClipModal = () => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, clip: undefined }),
      replace: true,
    })
  }

  const handleNavigateClip = React.useCallback(
    (entry: { id: string; gameSlug: string | null }) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({ ...prev, clip: entry.id }),
        ...(entry.gameSlug
          ? {
              mask: {
                to: "/g/$slug/c/$clipId",
                params: { slug: entry.gameSlug, clipId: entry.id },
              },
            }
          : {}),
        replace: true,
      })
    },
    [navigate]
  )

  return allowed ? (
    <AppSearchProvider>
      <UploadFlowProvider>
        <AppShell>
          <AppChrome />
          <Outlet />
          <UploadFlow />
        </AppShell>
      </UploadFlowProvider>
      <ClipViewerDialog
        clipId={clip ?? null}
        onClose={handleCloseClipModal}
        onNavigate={handleNavigateClip}
      />
    </AppSearchProvider>
  ) : null
}

const AppChrome = React.memo(function AppChrome() {
  return (
    <>
      <HomeSidebar />
      <HomeHeader />
    </>
  )
})
