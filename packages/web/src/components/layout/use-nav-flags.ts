import { useRouterState } from "@tanstack/react-router"

export interface NavFlags {
  isHome: boolean
  isGames: boolean
  isLibrary: boolean
}

/**
 * Active-section flags for the primary nav, derived from the current path.
 * Shared by the desktop rail and the mobile sheet so both highlight in sync.
 */
export function useNavFlags(): NavFlags {
  return useRouterState({
    select: (s) => ({
      isHome: s.location.pathname === "/",
      isGames:
        s.location.pathname === "/games" ||
        s.location.pathname.startsWith("/games/") ||
        s.location.pathname.startsWith("/g/"),
      isLibrary:
        s.location.pathname === "/library" ||
        s.location.pathname.startsWith("/library/"),
    }),
    structuralSharing: true,
  })
}
