import { AppMain, AppShell } from "@alloy/ui/components/app-shell"
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import * as React from "react"

import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { CreateActionsProvider } from "@/components/layout/create-actions"
import { CreateMenu } from "@/components/layout/create-menu"
import { HeaderToolbarProvider } from "@/components/layout/header-toolbar"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { SettingsDialog } from "@/components/routes/settings/settings-dialog"
import { AppSearchProvider } from "@/components/search/app-search"
import { UploadFlow } from "@/components/upload/upload-flow"
import { UploadFlowProvider } from "@/components/upload/upload-flow-controls"
import { type AppSearch, parseAppSearch } from "@/lib/app-search"
import { useSuspenseSession } from "@/lib/session-suspense"

export const Route = createFileRoute("/(app)/_app")({
  validateSearch: parseAppSearch,
  errorComponent: AppRouteErrorState,
  notFoundComponent: AppRouteNotFoundState,
  component: AppLayout,
})

function AppLayout() {
  const { clip, comment, settings } = Route.useSearch()
  const session = useSuspenseSession()
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
    (entry: { id: string; gameId: string | null }) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({
          ...prev,
          clip: entry.id,
          comment: undefined,
        }),
        ...(entry.gameId
          ? {
              mask: {
                to: "/games/$gameId/c/$clipId",
                params: { gameId: entry.gameId, clipId: entry.id },
              },
            }
          : {}),
        replace: true,
      })
    },
    [navigate],
  )

  const handleCloseSettings = React.useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, settings: undefined }),
      replace: true,
    })
  }, [navigate])

  const handleNavigateSettings = React.useCallback(
    (section: string) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({ ...prev, settings: section }),
        replace: true,
      })
    },
    [navigate],
  )

  return (
    <AppSearchProvider>
      <UploadFlowProvider>
        <HeaderToolbarProvider>
          <CreateActionsProvider>
            <AppShell>
              <AppChrome />
              <Outlet />
              <UploadFlow />
              <FloatingCreateMenu />
            </AppShell>
          </CreateActionsProvider>
        </HeaderToolbarProvider>
      </UploadFlowProvider>
      <ClipViewerDialog
        clipId={clip ?? null}
        focusedCommentId={comment ?? null}
        onClose={handleCloseClipModal}
        onNavigate={handleNavigateClip}
      />
      <SettingsDialog
        section={session ? (settings ?? null) : null}
        onNavigate={handleNavigateSettings}
        onClose={handleCloseSettings}
      />
    </AppSearchProvider>
  )
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
        <HeaderToolbarProvider>
          <CreateActionsProvider>
            <AppShell>
              <AppChrome />
              <AppMain>{children}</AppMain>
              <FloatingCreateMenu />
            </AppShell>
          </CreateActionsProvider>
        </HeaderToolbarProvider>
      </UploadFlowProvider>
    </AppSearchProvider>
  )
}

function FloatingCreateMenu() {
  const hidden = useRouterState({
    select: (state) => {
      const pathname = state.location.pathname
      return pathname === "/editor" || pathname.startsWith("/library/")
    },
  })

  if (hidden) return null

  return (
    <div className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] z-40 md:right-8 md:bottom-8">
      <CreateMenu placement="floating" />
    </div>
  )
}
