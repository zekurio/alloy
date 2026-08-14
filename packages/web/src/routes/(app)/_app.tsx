import { AppMain, AppShell } from "@alloy/ui/components/app-shell"
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { lazy, memo, Suspense, useCallback } from "react"
import type { ComponentProps, ReactNode } from "react"

import { WelcomeProfileDialog } from "@/components/auth/welcome-profile-dialog"
import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { DesktopScrubberGenerator } from "@/components/layout/desktop-scrubber-generator"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav"
import { SettingsDialog } from "@/components/routes/settings/settings-dialog"
import { AppSearchProvider } from "@/components/search/app-search"
import { UploadCenter } from "@/components/upload/upload-center"
import { UploadFlow } from "@/components/upload/upload-flow"
import { useWebUploadActionContext } from "@/components/upload/upload-flow-context"
import { UploadFlowProvider } from "@/components/upload/upload-flow-controls"
import { type AppSearch, parseAppSearch } from "@/lib/app-search"
import { useSuspenseSession } from "@/lib/session-suspense"

const loadLibraryEditorPage = async () => {
  const module = await import("@/components/routes/library/library-editor-page")
  return { default: module.LibraryEditorPage }
}

const LibraryEditorPage = lazy(loadLibraryEditorPage)

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
        <DesktopScrubberGenerator />
        <AppShellContent session={session !== null} />
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

function AppShellContent({ session }: { session: boolean }) {
  const webUploadAction = useWebUploadActionContext()
  const libraryEditorOpen = useRouterState({
    select: (state) => {
      const pathname = state.location.pathname
      return pathname.startsWith("/library/") && pathname !== "/library/"
    },
  })
  const editorOpen = libraryEditorOpen || webUploadAction.selected !== null

  return (
    <AppShell>
      <AppChrome />
      {webUploadAction.selected ? (
        <Suspense fallback={null}>
          <LibraryEditorPage uploadAction={webUploadAction} />
        </Suspense>
      ) : (
        <Outlet />
      )}
      <UploadFlow />
      {session && !editorOpen ? (
        <div className="fixed right-4 bottom-4 z-30 hidden md:flex">
          <UploadCenter />
        </div>
      ) : null}
      <MobileBottomNav />
    </AppShell>
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
        <AppShell>
          <AppChrome />
          <AppMain>{children}</AppMain>
          <UploadFlow />
        </AppShell>
      </UploadFlowProvider>
    </AppSearchProvider>
  )
}
