import { AppMain, AppShell } from "@alloy/ui/components/app-shell"
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router"
import { memo, useCallback } from "react"
import type { ComponentProps, ReactNode } from "react"

import { WelcomeProfileDialog } from "@/components/auth/welcome-profile-dialog"
import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { HeaderToolbarProvider } from "@/components/layout/header-toolbar"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav"
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
  const { clip, comment, settings, welcome } = Route.useSearch()
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

  const handleNavigateClip = useCallback(
    (entry: { id: string; gameId: string | null }) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({
          ...prev,
          clip: entry.id,
          comment: undefined,
        }),
        mask: entry.gameId
          ? {
              to: "/games/$gameId/clips/$clipId",
              params: { gameId: entry.gameId, clipId: entry.id },
            }
          : {
              to: "/clips/$clipId",
              params: { clipId: entry.id },
            },
        replace: true,
      })
    },
    [navigate],
  )

  const handleCloseSettings = useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, settings: undefined }),
      replace: true,
    })
  }, [navigate])

  const handleCloseWelcome = useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, welcome: undefined }),
      replace: true,
    })
  }, [navigate])

  const handleNavigateSettings = useCallback(
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
          <AppShell>
            <AppChrome />
            <Outlet />
            <UploadFlow />
            <MobileBottomNav />
          </AppShell>
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
      <WelcomeProfileDialog
        welcome={session ? (welcome ?? null) : null}
        onClose={handleCloseWelcome}
      />
    </AppSearchProvider>
  )
}

const AppChrome = memo(function AppChrome() {
  return (
    <>
      <HomeSidebar />
      <HomeHeader />
    </>
  )
})

function AppRouteErrorState(props: ComponentProps<typeof RouteErrorState>) {
  return (
    <AppRouteStateShell>
      <RouteErrorState {...props} variant="panel" />
    </AppRouteStateShell>
  )
}

function AppRouteNotFoundState(
  props: ComponentProps<typeof RouteNotFoundState>,
) {
  return (
    <AppRouteStateShell>
      <RouteNotFoundState {...props} variant="panel" />
    </AppRouteStateShell>
  )
}

function AppRouteStateShell({ children }: { children: ReactNode }) {
  return (
    <AppSearchProvider>
      <UploadFlowProvider>
        <HeaderToolbarProvider>
          <AppShell>
            <AppChrome />
            <AppMain>{children}</AppMain>
            <UploadFlow />
          </AppShell>
        </HeaderToolbarProvider>
      </UploadFlowProvider>
    </AppSearchProvider>
  )
}
