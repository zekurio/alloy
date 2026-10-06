import type {
  AdminGameRow,
  AdminUpdateGameInput,
  GameAssetRole,
  SteamGridDBAsset,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Spinner } from "@alloy/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@alloy/ui/components/tabs"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { cn } from "@alloy/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, CircleAlertIcon, ImageOffIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { adminKeys } from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

import {
  GAME_ASSET_FIELDS,
  GAME_ASSET_ROLES,
  GAME_ASSET_URL,
  setAdminGameCacheRow,
} from "./admin-game-data"

export interface SteamGridDBArtworkPickerProps {
  game: AdminGameRow
  /**
   * Blocks applying while the parent has an artwork write in flight (crop,
   * upload, remove) so two writes cannot race for the same slot. Browsing is
   * read-only and stays available.
   */
  disabled?: boolean
  /** Keeps the parent's upload slots disabled while a selection is saving. */
  onBusyChange?: (busy: boolean) => void
}

export function SteamGridDBArtworkPicker({
  game,
  disabled = false,
  onBusyChange,
}: SteamGridDBArtworkPickerProps) {
  if (game.steamgriddbId === null) return null

  return (
    <ArtworkBrowser
      game={game}
      disabled={disabled}
      onBusyChange={onBusyChange}
    />
  )
}

interface ArtworkBrowserProps {
  game: AdminGameRow
  disabled: boolean
  onBusyChange?: (busy: boolean) => void
}

function ArtworkBrowser({ game, disabled, onBusyChange }: ArtworkBrowserProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<GameAssetRole>("grid")
  const [applying, setApplying] = useState<{
    role: GameAssetRole
    assetId: number
  } | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const headingId = useId()
  const panelId = useId()

  const artworkQuery = useQuery({
    queryKey: [...adminKeys.games(), game.id, "artwork", role] as const,
    queryFn: () => api.admin.fetchGameArtwork(game.id, role),
    enabled: open,
    // One retry is enough for an upstream blip; the admin can ask again.
    retry: 1,
    // The upstream list only changes when SteamGridDB itself does.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const busy = applying !== null
  useEffect(() => {
    onBusyChange?.(busy)
    return () => {
      // A dialog closed mid-apply unmounts the picker without the request
      // settling; report idle so the parent's slots don't stay disabled.
      if (busy) onBusyChange?.(false)
    }
  }, [busy, onBusyChange])

  const applyArtwork = async (
    target: GameAssetRole,
    asset: SteamGridDBAsset,
  ) => {
    if (disabled || busy) return
    const patch: AdminUpdateGameInput = {}
    // `updateGame` uses the same URL field names the admin row exposes.
    patch[GAME_ASSET_URL[target]] = asset.url

    setApplyError(null)
    setApplying({ role: target, assetId: asset.id })
    try {
      setAdminGameCacheRow(
        queryClient,
        await api.admin.updateGame(game.id, patch),
      )
    } catch (cause) {
      setApplyError(errorMessage(cause, t("Couldn't apply artwork")))
    } finally {
      setApplying(null)
    }
  }

  const field = GAME_ASSET_FIELDS[role]
  const assets = artworkQuery.data?.assets ?? []
  // SAFETY: GAME_ASSET_URL maps only to nullable URL fields.
  const liveUrl = game[GAME_ASSET_URL[role]] as string | null

  return (
    <section
      aria-labelledby={headingId}
      className="border-border flex flex-col gap-3 border-t pt-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-sm font-semibold">
            {t("SteamGridDB artwork")}
          </h3>
          <p className="text-foreground-muted text-xs">
            {t("Pick artwork instead of uploading a file.")}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          // Locked mid-apply so the in-flight tile can't be collapsed out of
          // view before its result lands.
          disabled={busy}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("Hide") : t("Browse")}
        </Button>
      </div>

      {open ? (
        <div id={panelId}>
          <Tabs
            value={role}
            onValueChange={(value) => {
              // SAFETY: the triggers below are built from GAME_ASSET_ROLES,
              // so the only values reaching this handler are GameAssetRoles.
              setRole(value as GameAssetRole)
            }}
            className="gap-3"
          >
            <TabsList className="overflow-x-auto">
              {GAME_ASSET_ROLES.map((item) => (
                <TabsTrigger key={item} value={item} disabled={busy}>
                  {GAME_ASSET_FIELDS[item].label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={role}>
              {artworkQuery.isPending ? (
                <ArtworkSkeletonGrid role={role} />
              ) : artworkQuery.isError ? (
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
              ) : assets.length === 0 ? (
                <p className="text-foreground-muted text-sm">
                  {t("No {label} artwork on SteamGridDB.", {
                    label: field.label,
                  })}
                </p>
              ) : (
                <ul
                  className={cn(
                    "grid max-h-64 gap-2 overflow-y-auto overscroll-contain pr-1",
                    TILE_COLUMNS[role],
                  )}
                >
                  {assets.map((asset) => (
                    <ArtworkTile
                      key={asset.id}
                      asset={asset}
                      role={role}
                      applied={liveUrl === asset.url}
                      applying={
                        applying?.role === role && applying.assetId === asset.id
                      }
                      disabled={disabled || busy}
                      onApply={() => void applyArtwork(role, asset)}
                    />
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      {applyError ? (
        <Callout tone="destructive">
          <CircleAlertIcon aria-hidden />
          <span>{applyError}</span>
        </Callout>
      ) : null}
    </section>
  )
}

/**
 * Tile frames follow the shapes the server renders each slot to, so a hero
 * option reads as a banner and a grid option as a cover before it is applied.
 */
const TILE_ASPECT = {
  grid: "aspect-[3/4]",
  hero: "aspect-[96/31]",
  logo: "aspect-[5/2]",
  icon: "aspect-square",
} satisfies Record<GameAssetRole, string>

/** Wide frames need fewer, larger tiles to stay legible. */
const TILE_COLUMNS = {
  grid: "grid-cols-4",
  hero: "grid-cols-2",
  logo: "grid-cols-3 sm:grid-cols-4",
  icon: "grid-cols-4 sm:grid-cols-6",
} satisfies Record<GameAssetRole, string>

const SKELETON_TILES = 8

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

function ArtworkTile({
  asset,
  role,
  applied,
  applying,
  disabled,
  onApply,
}: {
  asset: SteamGridDBAsset
  role: GameAssetRole
  applied: boolean
  applying: boolean
  disabled: boolean
  onApply: () => void
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
        aria-pressed={applied}
        aria-busy={applying}
        disabled={disabled}
        onClick={() => {
          // Re-applying the live artwork would only make the server download
          // the same image again for its blurhash.
          if (!applied) onApply()
        }}
        className={cn(
          "group relative block w-full overflow-hidden rounded-md border",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-60",
          applied
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
        {applying ? (
          <span className="bg-background/60 absolute inset-0 flex items-center justify-center rounded-[inherit]">
            <Spinner />
          </span>
        ) : applied ? (
          <span className="bg-accent text-accent-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-full">
            <CheckIcon className="size-3" aria-hidden />
          </span>
        ) : null}
      </button>
    </li>
  )
}
