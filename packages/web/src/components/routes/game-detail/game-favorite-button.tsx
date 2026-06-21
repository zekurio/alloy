import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import { StarIcon } from "lucide-react"

import { errorMessage } from "@/lib/error-message"
import { useToggleGameFavoriteMutation } from "@/lib/game-queries"

type GameFavoriteButtonProps = {
  gameId: number | string
  viewer: { isFollowing: boolean } | null | undefined
  className?: string
}

export function GameFavoriteButton({
  gameId,
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
        size="icon"
        aria-label={t("Star")}
        title={t("Star")}
        disabled
        className={className}
      >
        <StarIcon />
      </Button>
    )
  }

  if (!viewer) {
    return (
      <Button
        type="button"
        variant="primary"
        size="icon"
        aria-label={t("Sign in to star")}
        title={t("Sign in to star")}
        className={className}
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        <StarIcon />
      </Button>
    )
  }

  const label = isStarred ? t("Starred") : t("Star")

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-pressed={isStarred}
      aria-label={label}
      title={label}
      className={cn(
        "hover:bg-transparent",
        isStarred
          ? "text-yellow-300 hover:text-yellow-200"
          : "text-white/80 hover:text-white",
        className,
      )}
      onClick={() => {
        mutation.mutate(
          { gameId: String(gameId), next: !isStarred },
          {
            onError: (cause) => {
              toast.error(errorMessage(cause, t("Something went wrong")))
            },
          },
        )
      }}
      disabled={mutation.isPending}
    >
      <StarIcon className={cn("size-5", isStarred && "fill-current")} />
    </Button>
  )
}
