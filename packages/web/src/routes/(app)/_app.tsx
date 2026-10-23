import { AppMain, AppShell } from "@alloy/ui/components/app-shell"
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { lazy, memo, Suspense, useCallback, useEffect } from "react"
import type { ComponentProps, ReactNode } from "react"

import { WelcomeProfileDialog } from "@/components/auth/welcome-profile-dialog"
import { ClipViewerDialog } from "@/components/clip/clip-viewer-dialog"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { HomeHeader } from "@/components/layout/home-header"
import { HomeSidebar } from "@/components/layout/home-sidebar"
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav"
import { SETTINGS_OVERVIEW_SECTION } from "@/components/routes/settings/settings-categories"
import { SettingsDialog } from "@/components/routes/settings/settings-dialog"
import { AppSearchProvider } from "@/components/search/app-search"
import { UploadCenter } from "@/components/upload/upload-center"
import { UploadFlow } from "@/components/upload/upload-flow"
import { useWebUploadActionContext } from "@/components/upload/upload-flow-context"
import { UploadFlowProvider } from "@/components/upload/upload-flow-controls"
import { type AppSearch, parseAppSearch } from "@/lib/app-search"
import { useOpenClipDialog } from "@/lib/clip-navigation"
import { alloyDesktop } from "@/lib/desktop"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useOpenSettings } from "@/lib/use-open-settings"

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
  const { clip, settings, welcome } = Route.useSearch()
  const session = useSuspenseSession()
  const navigate = useNavigate()
  const openClipDialog = useOpenClipDialog()
  const openDesktopSettings = useOpenSettings("desktop")
  const settingsFromOverview = useRouterState({
    select: (state) => state.location.state.settingsFromOverview === true,
  })

  useEffect(() => {
    if (!session) return
    return alloyDesktop()?.onOpenSettings?.(() => {
      // Keep an already-open section and its unsaved edits intact.
      if (!settings) openDesktopSettings()
    })
  }, [session, settings, openDesktopSettings])

  const handleCloseClipModal = () => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        clip: undefined,
      }),
      replace: true,
    })
  }

  const handleNavigateClip = useCallback(
    (entry: { id: string; gameId: string | null }) =>
      openClipDialog(entry.id, entry.gameId, { replace: true }),
    [openClipDialog],
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

  // The phone overview opens a section as its own history entry, marked so
  // the way back can pop it. The same entry is what lets the browser's back
  // gesture return to the overview.
  const handleOpenSettingsSection = useCallback(
    (section: string) => {
      void navigate({
        to: ".",
        search: (prev: AppSearch) => ({ ...prev, settings: section }),
        state: { settingsFromOverview: true },
        resetScroll: false,
      })
    },
    [navigate],
  )

  const handleSettingsBack = useCallback(() => {
    if (settingsFromOverview) {
      window.history.back()
      return
    }
    // Opened straight on a section (a link, a reload from elsewhere): there
    // is no overview entry to pop, so this entry becomes the overview.
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        settings: SETTINGS_OVERVIEW_SECTION,
      }),
      replace: true,
    })
  }, [navigate, settingsFromOverview])

  return (
    <AppSearchProvider>
      <UploadFlowProvider>
        <AppShellContent session={session !== null} />
      </UploadFlowProvider>
      <ClipViewerDialog
        clipId={clip ?? null}
        onClose={handleCloseClipModal}
        onNavigate={handleNavigateClip}
      />
      <SettingsDialog
        section={session ? (settings ?? null) : null}
        onNavigate={handleNavigateSettings}
        onOpenSection={handleOpenSettingsSection}
        onBack={handleSettingsBack}
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
        <div className="fixed right-[var(--app-content-padding)] bottom-[var(--app-content-padding)] z-30 hidden md:flex">
          <UploadCenter />
        </div>
      ) : null}
      <MobileBottomNav session={session} />
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
