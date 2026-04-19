import { Outlet, createFileRoute } from "@tanstack/react-router"

import { AppShell } from "@workspace/ui/components/app-shell"

import { HomeSidebar } from "../components/home-sidebar"

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
 * Headers stay inside child routes because they vary per surface (the home
 * feed gets `<HomeHeader>` with search; settings pages share a slim header
 * via the `_app._settings` layout). The grid in `AppShell` is data-slot
 * driven, so the child-rendered `<AppHeader>` and `<AppMain>` still land in
 * the right cells.
 */
export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

function AppLayout() {
  return (
    <AppShell>
      <HomeSidebar />
      <Outlet />
    </AppShell>
  )
}
