import type { GameAssetRole, SteamGridDBAsset } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { cn } from "@alloy/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon, CircleAlertIcon, ImageOffIcon } from "lucide-react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import { GAME_ASSET_FIELDS } from "./admin-game-data"

/**
 * The SteamGridDB options for one artwork slot. Picking is read-only here: the
 * parent stages the asset and writes it when the dialog is saved.
 */
export function SteamGridDBArtworkGrid({
  gameId,
  role,
  selectedUrl,
  disabled = false,
  onPick,
}: {
  gameId: string
  role: GameAssetRole
  /** The URL the slot would hold once saved, if it is a SteamGridDB one. */
  selectedUrl: string | null
  disabled?: boolean
  onPick: (asset: SteamGridDBAsset) => void
}) {
  const artworkQuery = useQuery({
    queryKey: [...adminKeys.games(), gameId, "artwork", role] as const,
    queryFn: () => api.admin.fetchGameArtwork(gameId, role),
    // One retry is enough for an upstream blip; the admin can ask again.
    retry: 1,
    // The upstream list only changes when SteamGridDB itself does.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const label = GAME_ASSET_FIELDS[role].label
  const assets = artworkQuery.data?.assets ?? []

  if (artworkQuery.isPending) return <ArtworkSkeletonGrid role={role} />

  if (artworkQuery.isError) {
    return (
      <Callout tone="destructive">
        <CircleAlertIcon aria-hidden />
        <div className="flex min-w-0 flex-col gap-2">
          <span>
            {errorMessage(
              artworkQuery.error,
              t("Couldn't load SteamGridDB artwork"),
            )}
          </span>
          <FeedbackButton
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            state={artworkQuery.isFetching ? "pending" : "idle"}
            pendingLabel={t("Loading…")}
            onClick={() => void artworkQuery.refetch()}
          >
            {t("Try again")}
          </FeedbackButton>
        </div>
      </Callout>
    )
  }

  if (assets.length === 0) {
    return (
      <p className="text-foreground-muted text-sm">
        {t("No {label} artwork on SteamGridDB.", { label })}
      </p>
    )
  }

  return (
    <ul
      aria-label={t("SteamGridDB artwork")}
      className={cn("grid gap-2", TILE_COLUMNS[role])}
    >
      {assets.map((asset) => (
        <ArtworkOption
          key={asset.id}
          asset={asset}
          role={role}
          selected={selectedUrl === asset.url}
          disabled={disabled}
          onPick={() => onPick(asset)}
        />
      ))}
    </ul>
  )
}

/**
 * Tile frames follow the shapes the server renders each slot to, so a hero
 * option reads as a banner and a grid option as a cover before it is picked.
 */
const TILE_ASPECT = {
  grid: "aspect-[3/4]",
  hero: "aspect-[96/31]",
  logo: "aspect-[5/2]",
  icon: "aspect-square",
} satisfies Record<GameAssetRole, string>

/** Wide frames need fewer, larger tiles to stay legible. */
const TILE_COLUMNS = {
  grid: "grid-cols-4 sm:grid-cols-6",
  hero: "grid-cols-2 sm:grid-cols-3",
  logo: "grid-cols-3 sm:grid-cols-4",
  icon: "grid-cols-5 sm:grid-cols-8",
} satisfies Record<GameAssetRole, string>

const SKELETON_TILES = 12

function ArtworkSkeletonGrid({ role }: { role: GameAssetRole }) {
  return (
    <div className={cn("grid gap-2", TILE_COLUMNS[role])} aria-busy>
      <span role="status" className="sr-only">
        {t("Loading…")}
      </span>
      {Array.from({ length: SKELETON_TILES }, (_, index) => (
        <Skeleton key={index} className={cn("w-full", TILE_ASPECT[role])} />
      ))}
    </div>
  )
}

function ArtworkOption({
  asset,
  role,
  selected,
  disabled,
  onPick,
}: {
  asset: SteamGridDBAsset
  role: GameAssetRole
  selected: boolean
  disabled: boolean
  onPick: () => void
}) {
  const label = GAME_ASSET_FIELDS[role].label
  // SteamGridDB thumbnails are much smaller than the image that gets applied;
  // logos and icons have no thumbnail, so the full image stands in.
  const src = asset.thumb ?? asset.url
  const image = useImageLoaded(src)
  // Near-identical options are common, and SGDB's own style/pixel metadata is
  // what tells them apart — so it belongs on hover rather than in the grid.
  const details = [
    asset.style,
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <li>
      <button
        type="button"
        title={details || label}
        aria-label={t("Use this {label} artwork", { label })}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
        className={cn(
          "group relative block w-full overflow-hidden rounded-md border",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-60",
          selected
            ? "border-accent-border"
            : "border-border hover:border-border-strong",
        )}
      >
        <span
          className={cn(
            "bg-surface-sunken flex items-center justify-center",
            TILE_ASPECT[role],
          )}
        >
          {image.status === "error" ? (
            <ImageOffIcon
              className="text-foreground-faint size-4"
              aria-hidden
            />
          ) : (
            <img
              ref={image.ref}
              src={src}
              alt=""
              loading="lazy"
              onLoad={image.markLoaded}
              onError={image.markError}
              className="block size-full object-contain"
            />
          )}
        </span>
        {selected ? (
          <span className="bg-accent text-accent-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-full">
            <CheckIcon className="size-3" aria-hidden />
          </span>
        ) : null}
      </button>
    </li>
  )
}
