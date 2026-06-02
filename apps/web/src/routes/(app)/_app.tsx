import * as React from "react"
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"

import { AppMain, AppShell } from "@workspace/ui/components/app-shell"

import { AppSearchProvider } from "@/components/search/app-search"
import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { UploadFlow } from "@/components/upload/upload-flow"
import { UploadFlowProvider } from "@/components/upload/upload-flow-controls"
import { type AppSearch, parseAppSearch } from "@/lib/app-search"
import { requireBrowseAuthBeforeLoad } from "@/lib/auth-guards"
import { useBrowseAuthGate } from "@/lib/auth-hooks"

export const Route = createFileRoute("/(app)/_app")({
  beforeLoad: requireBrowseAuthBeforeLoad,
  validateSearch: parseAppSearch,
  errorComponent: AppRouteErrorState,
  notFoundComponent: AppRouteNotFoundState,
  component: AppLayout,
})

function AppLayout() {
  const { allowed } = useBrowseAuthGate()
  const { clip, comment } = Route.useSearch()
  const navigate = useNavigate()

  const handleCloseClipModal = () => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        clip: undefined,
        comment: undefined,
      }),
      replace: true,
    })
  }

  const handleNavigateClip = React.useCallback(
    (entry: { id: string; gameSlug: string | null }) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({
          ...prev,
          clip: entry.id,
          comment: undefined,
        }),
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
    [navigate],
  )

  return allowed
    ? (
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
          focusedCommentId={comment ?? null}
          onClose={handleCloseClipModal}
          onNavigate={handleNavigateClip}
        />
      </AppSearchProvider>
    )
    : null
}

const AppChrome = React.memo(function AppChrome() {
  return (
    <>
      <HomeSidebar />
      <HomeHeader />
    </>
  )
})

function AppRouteErrorState(
  props: React.ComponentProps<typeof RouteErrorState>,
) {
  return (
    <AppRouteStateShell>
      <RouteErrorState {...props} variant="panel" />
    </AppRouteStateShell>
  )
}

function AppRouteNotFoundState(
  props: React.ComponentProps<typeof RouteNotFoundState>,
) {
  return (
    <AppRouteStateShell>
      <RouteNotFoundState {...props} variant="panel" />
    </AppRouteStateShell>
  )
}

function AppRouteStateShell({ children }: { children: React.ReactNode }) {
  return (
    <AppSearchProvider>
      <UploadFlowProvider>
        <AppShell>
          <AppChrome />
          <AppMain>{children}</AppMain>
        </AppShell>
      </UploadFlowProvider>
    </AppSearchProvider>
  )
}
