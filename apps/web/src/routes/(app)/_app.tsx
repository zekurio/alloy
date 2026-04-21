import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"

import { AppShell } from "@workspace/ui/components/app-shell"

import { AppSearchProvider } from "../../components/app-search"
import { ClipPlayerModal } from "../../components/clip-player-modal"
import { HomeHeader } from "../../components/home-header"
import { HomeSidebar } from "../../components/home-sidebar"
import { UploadFlow } from "../../components/upload-flow"

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

  return (
    <AppSearchProvider>
      <AppShell>
        <HomeSidebar />
        {showSharedHeader ? <HomeHeader /> : null}
        <Outlet />
        <UploadFlow />
      </AppShell>
      <ClipPlayerModal
        clipId={clip ?? null}
        onClose={handleCloseClipModal}
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
