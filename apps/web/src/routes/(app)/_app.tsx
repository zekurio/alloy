import * as React from "react"
import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"

import { AppShell } from "@workspace/ui/components/app-shell"

import { AppSearchProvider } from "@/components/search/app-search"
import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { UploadFlow } from "@/components/upload/upload-flow"

interface AppSearch {
  clip?: string
}

export const Route = createFileRoute("/(app)/_app")({
  validateSearch: (search: Record<string, unknown>): AppSearch => {
    const clip = search.clip
    return typeof clip === "string" && clip.length > 0 ? { clip } : {}
  },
  component: AppLayout,
})

function AppLayout() {
  const { clip } = Route.useSearch()
  const navigate = useNavigate()
  const showSharedHeader = useRouterState({
    select: (s) => !isSettingsPath(s.location.pathname),
  })

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

  return (
    <AppSearchProvider>
      <AppShell>
        <HomeSidebar />
        {showSharedHeader ? <HomeHeader /> : null}
        <Outlet />
        <UploadFlow />
      </AppShell>
      <ClipViewerDialog
        clipId={clip ?? null}
        onClose={handleCloseClipModal}
        onNavigate={handleNavigateClip}
      />
    </AppSearchProvider>
  )
}

function isSettingsPath(pathname: string): boolean {
  return (
    pathname === "/user-settings" ||
    pathname.startsWith("/user-settings/") ||
    pathname === "/admin-settings" ||
    pathname.startsWith("/admin-settings/")
  )
}
