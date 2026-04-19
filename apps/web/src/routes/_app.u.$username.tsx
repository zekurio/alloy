import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarIcon, FilmIcon, GamepadIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { AppMain } from "@workspace/ui/components/app-shell";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";

import { ClipCardTrigger } from "../components/clip-player-dialog";
import { ClipGrid } from "../components/clip-grid";
import { EmptyState } from "../components/empty-state";
import { HomeHeader } from "../components/home-header";
import { ProfileActions } from "../components/profile-actions";
import { UploadFlow } from "../components/upload-flow";
import { hueForGame, toClipCardData } from "../lib/clip-format";
import {
  fetchUserClips,
  fetchUserProfile,
  type ProfileCounts,
  type ProfileViewer,
  type PublicUser,
  type UserClip,
} from "../lib/users-api";
import { avatarTint, displayInitials } from "../lib/user-display";
import { env } from "../lib/env";

/**
 * Public user profile at /u/$username.
 *
 * Layout is flat — no Card chrome — so the page feels continuous with the
 * home feed. A wide banner strip carries a deterministic gradient derived
 * from the user id, and the avatar overlaps its lower edge the way Medal
 * and Twitch both do it. Below the identity row, tabbed sections split the
 * content into Home (games carousel + recent clips), Clips (grid only),
 * and a couple of placeholder panels for Tagged / Stats.
 *
 * The `$username` segment accepts either a real username or a raw user id —
 * the server resolves both (`resolveTarget`) so any pre-username bookmarks
 * still land on the right page.
 *
 * Data loading is deliberately split into two calls:
 *   - the profile header (user row + counts + viewer state)
 *   - the clips grid
 * so the page paints progressively: skeleton → header → clips. It also
 * makes the error surface simpler — a failed clips fetch doesn't blank the
 * whole page.
 */
export const Route = createFileRoute("/_app/u/$username")({
  component: UserProfilePage,
});

type ProfileData = {
  user: PublicUser;
  counts: ProfileCounts;
  viewer: ProfileViewer | null;
};

function UserProfilePage() {
  const { username } = Route.useParams();
  const navigate = useNavigate();
  // Profile pages are public — `UserMenu` inside `HomeHeader` suspends on
  // its own Suspense boundary, rendering a chip skeleton until better-auth's
  // session atom resolves. Signed-out visitors see a Sign-in link instead.
  const [profile, setProfile] = React.useState<ProfileData | null>(null);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [clips, setClips] = React.useState<UserClip[] | null>(null);
  const [clipsError, setClipsError] = React.useState<string | null>(null);
  // When viewing a user the viewer has blocked, the page paints blurred and
  // a confirm dialog asks whether to reveal. `revealed` overrides the gate
  // for the rest of the visit; resetting on username change ensures the
  // warning re-appears for each new blocked profile.
  const [revealed, setRevealed] = React.useState(false);

  // Reset state on navigation between profiles so we don't briefly show
  // the previous user's header.
  React.useEffect(() => {
    setProfile(null);
    setProfileError(null);
    setClips(null);
    setClipsError(null);
    setRevealed(false);

    let cancelled = false;
    fetchUserProfile(username)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setProfileError(
          cause instanceof Error ? cause.message : "Couldn't load profile",
        );
      });

    fetchUserClips(username)
      .then((rows) => {
        if (!cancelled) setClips(rows);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setClipsError(
          cause instanceof Error ? cause.message : "Couldn't load clips",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  const isBlockedView = !!(
    profile?.viewer &&
    !profile.viewer.isSelf &&
    profile.viewer.isBlocked
  );
  const gated = isBlockedView && !revealed;

  return (
    <>
      <HomeHeader />
      <AppMain>
        <div
          aria-hidden={gated ? true : undefined}
          className={
            gated ? "pointer-events-none blur-md select-none" : undefined
          }
        >
          {profileError ? (
            <EmptyState
              seed={`profile-error-${username}`}
              size="lg"
              title="Couldn't load profile"
              hint={profileError}
            />
          ) : profile ? (
            <ProfileIdentity
              profile={profile}
              onViewerChange={(viewer) =>
                setProfile((current) =>
                  current ? { ...current, viewer } : current,
                )
              }
              /**
               * Counts are read-only from the header's perspective, but a
               * follow/unfollow action affects the target's follower count.
               * Refetching on every action would flicker, so we patch
               * locally and let the next page load reconcile if needed.
               */
              onFollowerDelta={(delta) =>
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        counts: {
                          ...current.counts,
                          followers: Math.max(
                            0,
                            current.counts.followers + delta,
                          ),
                        },
                      }
                    : current,
                )
              }
            />
          ) : (
            <ProfileIdentitySkeleton />
          )}

          <ProfileTabs clips={clips} clipsError={clipsError} />
        </div>

        <BlockedGate
          open={gated}
          handle={username}
          onReveal={() => setRevealed(true)}
          onCancel={() => {
            void navigate({ to: "/" });
          }}
        />
      </AppMain>
      <UploadFlow />
    </>
  );
}

function BlockedGate({
  open,
  handle,
  onReveal,
  onCancel,
}: {
  open: boolean;
  handle: string;
  onReveal: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Show this profile?</AlertDialogTitle>
          <AlertDialogDescription>
            You've blocked @{handle}. Do you want to show their profile anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onReveal}>Show profile</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProfileIdentity({
  profile,
  onViewerChange,
  onFollowerDelta,
}: {
  profile: ProfileData;
  onViewerChange: (viewer: ProfileViewer) => void;
  onFollowerDelta: (delta: number) => void;
}) {
  const { user, counts, viewer } = profile;
  const handle = user.username;
  const initials = displayInitials(handle);
  const { bg, fg } = avatarTint(user.id);
  const joined = formatJoined(user.createdAt);
  const bannerStyle = useBannerGradient(user.image, handle, user.id);

  return (
    <section className="mb-8">
      <div
        aria-hidden
        className="h-32 w-full rounded-lg sm:h-40"
        style={bannerStyle}
      />

      <div className="-mt-10 flex flex-col gap-5 px-1 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="flex items-end gap-5">
          <Avatar
            size="2xl"
            ring
            style={{ background: bg, color: fg }}
            className="shadow-[0_8px_24px_oklch(0_0_0_/_0.45)]"
          >
            {user.image ? <AvatarImage src={user.image} alt={handle} /> : null}
            <AvatarFallback style={{ background: bg, color: fg }}>
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-col gap-1.5 pb-1">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">
              @{handle}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs leading-none text-foreground-faint">
              <span className="inline-flex items-center gap-1.5 leading-none">
                <CalendarIcon className="size-3 shrink-0" aria-hidden />
                <span>joined {joined}</span>
              </span>
            </div>
            <IdentityStats counts={counts} />
          </div>
        </div>

        <div className="flex shrink-0 items-center sm:pb-1">
          <ProfileActions
            targetHandle={handle}
            viewer={viewer}
            onChange={(next) => {
              // The action component computes the next viewer; we mirror
              // the follower count here so the header stays accurate.
              const wasFollowing = viewer?.isFollowing ?? false;
              const willFollow = next.isFollowing;
              if (wasFollowing !== willFollow) {
                onFollowerDelta(willFollow ? 1 : -1);
              }
              // If the action created a block, the follow got dropped too
              // — apply that delta as well.
              if (!viewer?.isBlocked && next.isBlocked && wasFollowing) {
                onFollowerDelta(-1);
              }
              onViewerChange(next);
            }}
          />
        </div>
      </div>
    </section>
  );
}

function IdentityStats({ counts }: { counts: ProfileCounts }) {
  return (
    <div className="flex items-center gap-4 text-sm text-foreground-dim">
      <StatInline value={counts.clips} label="clips" />
      <span aria-hidden className="text-foreground-faint">
        ·
      </span>
      <StatInline value={counts.followers} label="followers" />
      <span aria-hidden className="text-foreground-faint">
        ·
      </span>
      <StatInline value={counts.following} label="following" />
    </div>
  );
}

function StatInline({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-2xs tracking-[0.1em] text-foreground-faint uppercase">
        {label}
      </span>
    </span>
  );
}

function ProfileIdentitySkeleton() {
  return (
    <section className="mb-8">
      <Skeleton className="h-32 w-full rounded-lg sm:h-40" />
      <div className="-mt-10 flex items-end gap-5 px-1 sm:-mt-12">
        <Skeleton className="size-24 rounded-lg" />
        <div className="flex flex-col gap-2 pb-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    </section>
  );
}

function ProfileTabs({
  clips,
  clipsError,
}: {
  clips: UserClip[] | null;
  clipsError: string | null;
}) {
  return (
    <Tabs defaultValue="home">
      <TabsList className="mb-8">
        <TabsTrigger value="home">Home</TabsTrigger>
        <TabsTrigger value="clips">
          Clips
          {clips ? <TabsCount>{clips.length}</TabsCount> : null}
        </TabsTrigger>
        <TabsTrigger value="tagged">Tagged</TabsTrigger>
      </TabsList>

      <TabsContent value="home">
        <GamesSection clips={clips} />
        <ClipsSection clips={clips} error={clipsError} variant="recent" />
      </TabsContent>

      <TabsContent value="clips">
        <ClipsSection clips={clips} error={clipsError} variant="all" />
      </TabsContent>

      <TabsContent value="tagged">
        <EmptyState
          seed="profile-tagged-empty"
          size="lg"
          title="No tagged clips yet"
          hint="Clips where this user is tagged will show up here."
        />
      </TabsContent>
    </Tabs>
  );
}

type GameEntry = {
  name: string;
  count: number;
  hue: number;
};

function GamesSection({ clips }: { clips: UserClip[] | null }) {
  const games = React.useMemo<GameEntry[] | null>(() => {
    if (clips === null) return null;
    const counts = new Map<string, number>();
    for (const clip of clips) {
      if (!clip.game) continue;
      counts.set(clip.game, (counts.get(clip.game) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, hue: hueForGame(name) }))
      .sort((a, b) => b.count - a.count);
  }, [clips]);

  return (
    <section className="mb-10">
      <SectionHead>
        <div>
          <SectionTitle>
            <GamepadIcon className="text-accent" />
            Games played
          </SectionTitle>
        </div>
        <SectionActions>
          {games && games.length > 0 ? (
            <span className="font-mono text-2xs text-foreground-faint">
              {games.length} {games.length === 1 ? "game" : "games"}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      {games === null ? (
        <GamesRow>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[184px] w-40 rounded-md" />
          ))}
        </GamesRow>
      ) : games.length === 0 ? (
        <EmptyState
          seed="profile-games-empty"
          size="md"
          title="No games yet"
          hint="Upload a clip to start the list."
        />
      ) : (
        <GamesRow>
          {games.map((g) => (
            <GameTile key={g.name} game={g} />
          ))}
        </GamesRow>
      )}
    </section>
  );
}

/**
 * Horizontally-scrolling shelf of game tiles. The `snap-x` keeps the
 * carousel pleasant to swipe on touch, and the `-mx-8 px-8` trick lets
 * the scroll area bleed to the edges of `AppMain` while the first tile
 * still lines up with the section heading.
 */
function GamesRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-8 overflow-x-auto px-8 pb-2">
      <div className="flex snap-x snap-mandatory gap-3">{children}</div>
    </div>
  );
}

function GameTile({ game }: { game: GameEntry }) {
  const label = gameAbbreviation(game.name);
  return (
    <article
      className={[
        "group/game-tile relative flex h-[184px] w-40 shrink-0 snap-start",
        "flex-col overflow-hidden rounded-md",
        "transition-[box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:shadow-[0_0_0_1px_var(--accent-border)]",
      ].join(" ")}
      style={{
        background: `linear-gradient(160deg, oklch(0.34 0.18 ${game.hue}) 0%, oklch(0.18 0.08 ${game.hue}) 60%, oklch(0.1 0.02 ${game.hue}) 100%)`,
      }}
    >
      <div className="flex flex-1 items-center justify-center px-3">
        <span
          className="text-center font-mono text-[32px] leading-none font-semibold tracking-[-0.02em]"
          style={{ color: `oklch(0.94 0.08 ${game.hue})` }}
        >
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 bg-black/25 px-3 py-2 backdrop-blur-[2px]">
        <span className="truncate text-sm font-semibold text-foreground">
          {game.name}
        </span>
        <span className="font-mono text-2xs text-foreground-faint">
          {game.count} {game.count === 1 ? "clip" : "clips"}
        </span>
      </div>
    </article>
  );
}

function ClipsSection({
  clips,
  error,
  variant,
}: {
  clips: UserClip[] | null;
  error: string | null;
  variant: "recent" | "all";
}) {
  return (
    <section>
      <SectionHead>
        <div>
          <SectionTitle>
            <FilmIcon className="text-accent" />
            {variant === "recent" ? "Recent clips" : "All clips"}
          </SectionTitle>
        </div>
        <SectionActions>
          {clips ? (
            <span className="font-mono text-2xs text-foreground-faint">
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
            </span>
          ) : null}
        </SectionActions>
      </SectionHead>

      {error ? (
        <EmptyState
          seed={`profile-${variant}-error`}
          size="md"
          title="Couldn't load clips"
          hint={error}
        />
      ) : clips === null ? (
        <ClipGrid>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </ClipGrid>
      ) : clips.length === 0 ? (
        <EmptyState
          seed={`profile-${variant}-empty`}
          size="lg"
          title="No clips uploaded yet"
          hint="Clips from this user will show up here once they upload."
        />
      ) : (
        <ClipGrid>
          {clips.map((row) => {
            const card = toClipCardData(row)
            return (
              <ClipCardTrigger
                key={row.id}
                clipId={card.clipId}
                streamUrl={card.streamUrl}
                thumbnail={card.thumbnail}
                authorHandle={card.author}
                author={card.author}
                authorImage={card.authorImage}
                title={card.title}
                game={card.game}
                views={card.views}
                likes={card.likes}
                comments={card.comments}
                postedAt={card.postedAt}
                accentHue={card.accentHue}
              />
            )
          })}
        </ClipGrid>
      )}
    </section>
  );
}

function formatJoined(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

/**
 * Takes up to three letters from the game name to stamp on the tile — e.g.
 * "Valorant" → "VAL", "Apex Legends" → "APX", "CS2" → "CS2". Short names
 * (<= 3 chars) are used verbatim.
 */
function gameAbbreviation(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 3) return trimmed.toUpperCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  // single long word — pull the vowel-skipped opening letters
  const letters = trimmed.replace(/[aeiou]/gi, "");
  return (letters.length >= 3 ? letters : trimmed).slice(0, 3).toUpperCase();
}

/**
 * Resolve the banner gradient from the user's avatar image when possible,
 * falling back to the deterministic id-seeded gradient while the image
 * loads, on error, or when there's no image at all. The image is drawn to
 * a small offscreen canvas and three regions (left half, right half,
 * overall) are averaged to drive the three gradient stops — so the banner
 * literally borrows its colors from the picture sitting on top of it.
 *
 * OAuth provider CDNs (Discord/Google/GitHub) don't send CORS headers, so
 * drawing those URLs directly taints the canvas and `getImageData` throws.
 * We always sample through our own `/api/users/:username/avatar` proxy,
 * which re-emits the bytes under our origin with permissive CORS — that's
 * the only way the pixel read can succeed in the browser.
 */
function useBannerGradient(
  imageSrc: string | null | undefined,
  username: string,
  fallbackSeed: string,
): React.CSSProperties {
  const [palette, setPalette] = React.useState<AvatarPalette | null>(null);

  React.useEffect(() => {
    setPalette(null);
    if (!imageSrc) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      try {
        const next = samplePalette(img);
        if (next) setPalette(next);
      } catch {
        // Proxy misconfigured or canvas still tainted — keep the fallback.
      }
    };
    // Route through our server so the response carries CORS headers the
    // browser needs before it will hand us pixel data.
    img.src = `${env.VITE_API_URL}/api/users/${encodeURIComponent(username)}/avatar`;
    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [imageSrc, username]);

  return palette ? paletteGradient(palette) : bannerGradient(fallbackSeed);
}

type Rgb = { r: number; g: number; b: number };
type AvatarPalette = { left: Rgb; right: Rgb; overall: Rgb };

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function samplePalette(img: HTMLImageElement): AvatarPalette | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const averageRegion = (x0: number, x1: number): Rgb => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = 0; y < size; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        const alpha = data[i + 3] ?? 0;
        if (alpha < 32) continue; // skip mostly-transparent pixels
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        n++;
      }
    }
    if (n === 0) return BLACK;
    return { r: r / n, g: g / n, b: b / n };
  };

  return {
    left: averageRegion(0, size / 2),
    right: averageRegion(size / 2, size),
    overall: averageRegion(0, size),
  };
}

function mix(color: Rgb, target: Rgb, t: number): Rgb {
  return {
    r: color.r + (target.r - color.r) * t,
    g: color.g + (target.g - color.g) * t,
    b: color.b + (target.b - color.b) * t,
  };
}

function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

/**
 * Three-stop gradient driven by sampled avatar colors. The top-left
 * highlight comes from the avatar's left half (mixed slightly toward
 * white so it still reads as a light source), the top-right glow uses
 * the right half verbatim, and the base linear gradient darkens the
 * overall average so the banner has depth without going muddy.
 */
function paletteGradient({
  left,
  right,
  overall,
}: AvatarPalette): React.CSSProperties {
  const highlight = mix(left, WHITE, 0.15);
  const baseStart = mix(overall, BLACK, 0.5);
  const baseEnd = mix(overall, BLACK, 0.75);
  return {
    background: [
      `radial-gradient(120% 140% at 0% 0%, ${formatRgb(highlight)} 0%, transparent 55%)`,
      `radial-gradient(120% 140% at 100% 0%, ${formatRgb(right)} 0%, transparent 60%)`,
      `linear-gradient(135deg, ${formatRgb(baseStart)} 0%, ${formatRgb(baseEnd)} 100%)`,
    ].join(", "),
  };
}

/**
 * Deterministic fallback for users without an avatar image (or when the
 * avatar host blocks CORS). Anchored to the same hue `avatarTint` derives
 * from the id so the banner still coordinates with the avatar fallback.
 */
function bannerGradient(seed: string): React.CSSProperties {
  let h = 0;
  const key = seed || "user";
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return {
    background: [
      // Brighter highlight echoing the avatar foreground tint.
      `radial-gradient(120% 140% at 0% 0%, oklch(0.42 0.18 ${hue}) 0%, transparent 55%)`,
      // Mid-tone matching the avatar background fill.
      `radial-gradient(120% 140% at 100% 0%, oklch(0.32 0.18 ${hue}) 0%, transparent 60%)`,
      // Deep base keeps the banner grounded without leaving the hue family.
      `linear-gradient(135deg, oklch(0.22 0.12 ${hue}) 0%, oklch(0.14 0.06 ${hue}) 100%)`,
    ].join(", "),
  };
}
