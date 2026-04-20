import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"

import { AppShell } from "@workspace/ui/components/app-shell"

import { AppSearchProvider } from "../components/app-search"
import { HomeHeader } from "../components/home-header"
import { HomeSidebar } from "../components/home-sidebar"
import { UploadFlow } from "../components/upload-flow"

/**
 * Pathless layout that owns the persistent app chrome — `AppShell` + the
 * left rail. Every authed/public surface that should keep the rail mounted
 * across navigation lives underneath this route (`_app.index`,
 * `_app.u.$username`, the `_app._settings.*` cluster).
 *
 * Why this exists: previously every page route mounted its own `<AppShell>`
 * + `<HomeSidebar>`, so navigating between them tore the whole shell down
 * and rebuilt it. That meant the sidebar's `useSuspenseSession()` re-fired
 * its first-paint skeleton on every route change (the visible "flash"). By
 * hoisting the shell here once, the sidebar mounts a single time per page
 * load and only the inner `<Outlet/>` content swaps.
 *
 * The default top header now lives here too so the sidebar + header stream
 * as one stable chrome chunk; route-level suspense boundaries only swap the
 * main pane. The settings cluster still renders its own slim header, so this
 * layout skips the shared header on `/user-settings` and `/admin-settings`.
 */
export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

function AppLayout() {
  const showSharedHeader = useRouterState({
    select: (s) => !isSettingsPath(s.location.pathname),
  })

  return (
    <AppSearchProvider>
      <AppShell>
        <HomeSidebar />
        {showSharedHeader ? <HomeHeader /> : null}
        <Outlet />
        <UploadFlow />
      </AppShell>
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
