import type { ClipCardLabelLinkRenderer } from "@alloy/ui/components/clip-card"
import { Link } from "@tanstack/react-router"
import * as React from "react"

export function useClipCardAuthorLink(
  username: string | null | undefined,
): ClipCardLabelLinkRenderer | undefined {
  return React.useMemo<ClipCardLabelLinkRenderer | undefined>(() => {
    if (!username) return undefined

    return function renderClipCardAuthorLink({ children, className, onClick }) {
      return (
        <Link
          to="/u/$username"
          params={{ username }}
          className={className}
          onClick={onClick}
        >
          {children}
        </Link>
      )
    }
  }, [username])
}

export function useClipCardGameLink(
  gameId: number | string | null | undefined,
): ClipCardLabelLinkRenderer | undefined {
  return React.useMemo<ClipCardLabelLinkRenderer | undefined>(() => {
    if (!gameId) return undefined

    return function renderClipCardGameLink({ children, className, onClick }) {
      return (
        <Link
          to="/games/$gameId"
          params={{ gameId: String(gameId) }}
          className={className}
          onClick={onClick}
        >
          {children}
        </Link>
      )
    }
  }, [gameId])
}
