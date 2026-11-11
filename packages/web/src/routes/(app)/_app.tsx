import { AppMain, AppShell } from "@alloy/ui/components/app-shell"
import { animateWithMotionTokens } from "@alloy/ui/lib/motion"
import {
  createFileRoute,
  Outlet,
  useMatch,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import {
  Activity,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"
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
import { loadLibraryEditorPage } from "@/components/routes/library/load-library-editor-page"
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
import {
  SETTINGS_OVERVIEW,
  settingsAddress,
  settingsOverPage,
  settingsPageFromSplat,
} from "@/lib/settings-location"
import { useOpenSettings } from "@/lib/use-open-settings"

const LibraryEditorPage = lazy(loadLibraryEditorPage)

export const Route = createFileRoute("/(app)/_app")({
  validateSearch: parseAppSearch,
  errorComponent: AppRouteErrorState,
  notFoundComponent: AppRouteNotFoundState,
  component: AppLayout,
})

function AppLayout() {
  const { clip, welcome } = Route.useSearch()
  const session = useSuspenseSession()
  const navigate = useNavigate()
  const openClipDialog = useOpenClipDialog()
  const openDesktopSettings = useOpenSettings("desktop")
  // Settings opened over a page keeps its page in the history state; a
  // settings address visited as such names it in the path.
  const settingsOverPageId = useRouterState({
    select: (state) => state.location.state.settingsPage ?? null,
  })
  const settingsAtAddress = useMatch({
    from: "/(app)/_app/settings/$",
    shouldThrow: false,
    select: (match) => settingsPageFromSplat(match.params._splat),
  })
  const onSettingsAddress =
    settingsOverPageId === null && settingsAtAddress !== undefined
  const settings = settingsOverPageId ?? settingsAtAddress ?? null
  const settingsFromOverview = useRouterState({
    select: (state) => state.location.state.settingsFromOverview === true,
  })

  useEffect(() => {
    if (!session) return
    return alloyDesktop()?.onOpenSettings(() => {
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

  // Over a page, dropping the settings state and the mask leaves that page at
  // the address it had before settings opened. A settings address has no
  // earlier page, so it closes onto the home feed it shows.
  const handleCloseSettings = useCallback(() => {
    if (onSettingsAddress) {
      void navigate({ to: "/", replace: true, resetScroll: false })
      return
    }
    void navigate({
      to: ".",
      search: true,
      hash: true,
      replace: true,
      resetScroll: false,
    })
  }, [navigate, onSettingsAddress])

  const handleCloseWelcome = useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({ ...prev, welcome: undefined }),
      replace: true,
    })
  }, [navigate])

  const showSettingsPage = useCallback(
    (page: string, { replace = false, fromOverview = false } = {}) => {
      // On a settings address the address is what names the page.
      if (onSettingsAddress) {
        void navigate({
          ...settingsAddress(page),
          state: fromOverview ? { settingsFromOverview: true } : undefined,
          replace,
          resetScroll: false,
        })
        return
      }
      void navigate({ ...settingsOverPage(page, fromOverview), replace })
    },
    [navigate, onSettingsAddress],
  )

  const handleNavigateSettings = useCallback(
    (page: string) => showSettingsPage(page, { replace: true }),
    [showSettingsPage],
  )

  // The phone overview opens a section as its own history entry, marked so
  // the way back can pop it. The same entry is what lets the browser's back
  // gesture return to the overview.
  const handleOpenSettingsSection = useCallback(
    (page: string) => showSettingsPage(page, { fromOverview: true }),
    [showSettingsPage],
  )

  const handleSettingsBack = useCallback(() => {
    if (settingsFromOverview) {
      window.history.back()
      return
    }
    // Opened straight on a section (a link, a reload from elsewhere): there
    // is no overview entry to pop, so this entry becomes the overview.
    handleNavigateSettings(SETTINGS_OVERVIEW)
  }, [handleNavigateSettings, settingsFromOverview])

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
        section={session ? settings : null}
        onNavigate={handleNavigateSettings}
        onOpenSection={handleOpenSettingsSection}
        onBack={handleSettingsBack}
        onClose={handleCloseSettings}
      />
      <WelcomeProfileDialog
        open={session !== null && welcome === true}
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
  const uploadEditorOpen = webUploadAction.selected !== null
  const editorOpen = libraryEditorOpen || uploadEditorOpen

  // The page comes back exactly as it was left when the editor closes; fade
  // it in rather than snapping it over the editor's last frame.
  const uploadEditorWasOpen = useRef(false)
  useLayoutEffect(() => {
    const closed = uploadEditorWasOpen.current && !uploadEditorOpen
    uploadEditorWasOpen.current = uploadEditorOpen
    if (!closed) return
    // The shell's own main region: the grid places pages by this slot, so
    // every page under the outlet renders one as a direct child.
    const main = document.querySelector<HTMLElement>(
      '[data-slot="app-shell"] > [data-slot="app-main"]',
    )
    if (main) animateWithMotionTokens(main, { opacity: [0, 1] })
  }, [uploadEditorOpen])

  return (
    <AppShell>
      <AppChrome />
      {/* Always mounted: the pick lands in a transition, so the page stays
          up until the editor is ready rather than this boundary blanking
          the main area with its fallback. It comes before the page so the
          skip link's #app-main lookup finds the editor while both exist. */}
      <Suspense fallback={null}>
        {uploadEditorOpen ? (
          <LibraryEditorPage uploadAction={webUploadAction} />
        ) : null}
      </Suspense>
      {/* Hidden rather than unmounted under the editor, so the page keeps
          its scroll position and state. Activity also tears down its
          effects meanwhile, so its window shortcuts (a library entry's
          Delete, for one) can't fire from behind the editor. */}
      <Activity mode={uploadEditorOpen ? "hidden" : "visible"}>
        <Outlet />
      </Activity>
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
