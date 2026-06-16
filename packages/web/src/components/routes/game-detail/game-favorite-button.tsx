import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import { StarIcon } from "lucide-react"

import { errorMessage } from "@/lib/error-message"
import { useToggleGameFavoriteMutation } from "@/lib/game-queries"

type GameFavoriteButtonProps = {
  slug: string
  viewer: { isFollowing: boolean } | null | undefined
  className?: string
}

/**
 * Labeled star toggle, the game-page analog of the profile Follow button. The
 * favourites count lives in the identity stat row, so this carries only the
 * action — keeping it from reading as a stranded number at the card edge.
 */
export function GameFavoriteButton({
  slug,
  viewer,
  className,
}: GameFavoriteButtonProps) {
  const navigate = useNavigate()
  const mutation = useToggleGameFavoriteMutation()
  const isStarred = viewer?.isFollowing ?? false

  if (viewer === undefined) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Star"
        disabled
        className={className}
      >
        <StarIcon />
        Star
      </Button>
    )
  }

  if (!viewer) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        aria-label="Sign in to star"
        title="Sign in to star"
        className={className}
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        <StarIcon />
        Star
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={isStarred ? "ghost" : "primary"}
      size="sm"
      aria-pressed={isStarred}
      className={className}
      onClick={() => {
        mutation.mutate(
          { slug, next: !isStarred },
          {
            onError: (cause) => {
              toast.error(errorMessage(cause, "Something went wrong"))
            },
          },
        )
      }}
      disabled={mutation.isPending}
    >
      <StarIcon className={cn(isStarred && "fill-current")} />
      {isStarred ? "Starred" : "Star"}
    </Button>
  )
}
