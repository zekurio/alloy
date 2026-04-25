import { useNavigate } from "@tanstack/react-router"
import { StarIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/lib/toast"
import { cn } from "@workspace/ui/lib/utils"

import { formatCount } from "@/lib/clip-format"
import { useToggleGameFavoriteMutation } from "@/lib/game-queries"

type GameFavoriteButtonProps = {
  slug: string
  viewer: { isFollowing: boolean } | null | undefined
  count: number
  className?: string
}

export function GameFavoriteButton({
  slug,
  viewer,
  count,
  className,
}: GameFavoriteButtonProps) {
  const navigate = useNavigate()
  const mutation = useToggleGameFavoriteMutation()
  const isStarred = viewer?.isFollowing ?? false
  const label = formatCount(count)

  const sharedContent = (
    <>
      <StarIcon className={cn(isStarred && "fill-current")} />
      <span className="tabular-nums">{label}</span>
    </>
  )

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
        {sharedContent}
      </Button>
    )
  }

  if (!viewer) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Sign in to star"
        title="Sign in to star"
        className={className}
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        {sharedContent}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={isStarred ? "accent-outline" : "ghost"}
      size="sm"
      aria-pressed={isStarred}
      aria-label={isStarred ? "Unstar" : "Star"}
      title={isStarred ? "Unstar" : "Star"}
      className={className}
      onClick={() => {
        mutation.mutate(
          { slug, next: !isStarred },
          {
            onError: (cause) => {
              toast.error(
                cause instanceof Error ? cause.message : "Something went wrong"
              )
            },
          }
        )
      }}
      disabled={mutation.isPending}
    >
      {sharedContent}
    </Button>
  )
}
