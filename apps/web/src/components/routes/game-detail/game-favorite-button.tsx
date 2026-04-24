import { useNavigate } from "@tanstack/react-router"
import { StarIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import { useToggleGameFavoriteMutation } from "@/lib/game-queries"

type GameFavoriteButtonProps = {
  slug: string
  viewer: { isFollowing: boolean } | null | undefined
  className?: string
}

export function GameFavoriteButton({
  slug,
  viewer,
  className,
}: GameFavoriteButtonProps) {
  const navigate = useNavigate()
  const mutation = useToggleGameFavoriteMutation()
  const isFavorite = viewer?.isFollowing ?? false

  if (viewer === undefined) {
    return (
      <Button type="button" variant="primary" size="sm" disabled>
        <StarIcon />
        Favourite
      </Button>
    )
  }

  if (!viewer) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        className={className}
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        <StarIcon />
        Sign in to favourite
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={isFavorite ? "ghost" : "primary"}
      size="sm"
      className={className}
      onClick={() => {
        mutation.mutate(
          { slug, next: !isFavorite },
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
      <StarIcon className={cn(isFavorite && "fill-current")} />
      {mutation.isPending
        ? "Working..."
        : isFavorite
          ? "Favourited"
          : "Favourite"}
    </Button>
  )
}
