import { tp } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { cn } from "@alloy/ui/lib/utils"
import type {
  ComponentProps,
  MouseEvent,
  MouseEventHandler,
  ReactNode,
} from "react"

import { ClipCardThumb } from "./clip-card-thumb"

/**
 * The formatted view count and the number that picks its plural. Cards that
 * replace the stats row with `metaContent` can leave both out.
 */
type ClipCardViews =
  | { views: string; viewCount: number }
  | { views?: undefined; viewCount?: undefined }

type ClipCardProps = ComponentProps<"article"> &
  ClipCardViews & {
    imageAspectRatio?: number
    title: string
    titleContent?: ReactNode
    /** Omit for cards without an owner, such as local library entries. */
    author?: string
    authorImage?: string | null
    authorAvatarBg?: string
    authorAvatarFg?: string
    authorHref?: string | null
    renderAuthorLink?: ClipCardLabelLinkRenderer
    game: string
    gameIcon?: string | null
    gameHref?: string | null
    renderGameLink?: ClipCardLabelLinkRenderer
    postedAt?: string
    /** Replaces the views and posted-at row. */
    metaContent?: ReactNode
    thumbnail?: string
    thumbnailFallback?: string
    thumbnailBlurHash?: string | null
    thumbnailFallbackBlurHash?: string | null
    fallbackSeed?: string | number
    streamUrl?: string
    /** Window within `streamUrl` that represents the clip preview. */
    streamRange?: { start: number; end: number }
    /** When set, the thumbnail becomes a button that fires this handler. */
    onThumbnailClick?: () => void
    /** When set, the title becomes a button that fires this handler. */
    onTitleClick?: () => void
    /** Fires on hover/focus/press so callers can warm data before open. */
    onThumbnailIntent?: () => void
    /** Fires on hover/focus/press over the title so callers can warm data. */
    onTitleIntent?: () => void
    /** Fires when hover-preview video playback is rejected by the browser. */
    onPreviewError?: (cause: unknown) => void
    /** Accessible label for the thumbnail button. */
    thumbnailLabel?: string
    /** Accessible label for the title button. */
    titleLabel?: string
    metaVariant?: "default" | "gallery" | "compact"
  }

type ClipCardLabelLinkProps = {
  href?: string
  className: string
  children: ReactNode
  onClick: MouseEventHandler<HTMLAnchorElement>
  ariaLabel?: string
}

type ClipCardLabelLinkRenderer = (props: ClipCardLabelLinkProps) => ReactNode

function ClipCard({
  imageAspectRatio,
  className,
  title,
  titleContent,
  author,
  authorImage,
  authorAvatarBg,
  authorAvatarFg,
  authorHref,
  renderAuthorLink,
  game,
  gameIcon,
  gameHref,
  renderGameLink,
  views,
  viewCount,
  postedAt,
  metaContent,
  thumbnail,
  thumbnailFallback,
  thumbnailBlurHash,
  thumbnailFallbackBlurHash,
  fallbackSeed,
  streamUrl,
  streamRange,
  onThumbnailClick,
  onTitleClick,
  onThumbnailIntent,
  onTitleIntent,
  onPreviewError,
  thumbnailLabel,
  titleLabel,
  metaVariant = "default",
  ...props
}: ClipCardProps) {
  const titleButton = (
    <ClipCardTitleButton
      title={title}
      label={titleLabel}
      onClick={onTitleClick}
      onIntent={onTitleIntent}
    >
      {titleContent ?? title}
    </ClipCardTitleButton>
  )
  const smallAuthor = author ? (
    <>
      <ClipCardAvatar
        author={author}
        authorImage={authorImage}
        authorAvatarBg={authorAvatarBg}
        authorAvatarFg={authorAvatarFg}
        href={authorHref}
        renderLink={renderAuthorLink}
        size="sm"
        className="flex size-5 shrink-0"
      />
      <AuthorLabel
        author={author}
        href={authorHref}
        renderLink={renderAuthorLink}
      />
    </>
  ) : null
  const gameLabel = game ? (
    <GameLabel
      game={game}
      icon={gameIcon}
      href={gameHref}
      renderLink={renderGameLink}
    />
  ) : null
  const gallery = metaVariant === "gallery"
  const compact = metaVariant === "compact"
  const showAttributionRow = Boolean(author || game)
  const viewsLabel =
    views === undefined ? null : `${views} ${tp(viewCount, "view", "views")}`

  return (
    <article
      data-slot="clip-card"
      data-gallery={gallery || undefined}
      data-compact={compact || undefined}
      className={cn(
        "group/clip-card relative flex flex-col",
        gallery ? "overflow-hidden rounded-md" : "gap-1.5",
        compact && "grid grid-cols-[7rem_minmax(0,1fr)] items-stretch gap-3",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          gallery ? "relative flex" : "relative",
          !gallery &&
            !compact &&
            "-mx-[var(--app-content-padding,0.75rem)] md:mx-0",
          compact && "flex min-w-0 overflow-hidden rounded-md",
        )}
      >
        <ClipCardThumb
          imageAspectRatio={compact ? 16 / 9 : imageAspectRatio}
          title={title}
          thumbnail={thumbnail}
          thumbnailFallback={thumbnailFallback}
          thumbnailBlurHash={thumbnailBlurHash}
          thumbnailFallbackBlurHash={thumbnailFallbackBlurHash}
          fallbackSeed={fallbackSeed ?? game}
          streamUrl={streamUrl}
          streamRange={streamRange}
          onClick={onThumbnailClick}
          onIntent={onThumbnailIntent}
          onPreviewError={onPreviewError}
          label={thumbnailLabel ?? title}
        />
      </div>
      {compact ? (
        <div className="flex h-full min-w-0 flex-1 flex-col justify-between">
          <div className="text-foreground truncate text-sm leading-5 font-semibold">
            {titleButton}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
            {smallAuthor ? (
              <div className="flex min-w-0 items-center gap-1.5">
                {smallAuthor}
              </div>
            ) : null}
            {smallAuthor && gameLabel ? (
              <MetaSeparator className="text-foreground-faint" />
            ) : null}
            {gameLabel}
          </div>
          <div className="text-foreground-dim flex min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-4 whitespace-nowrap tabular-nums">
            {metaContent ?? (
              <ClipCardStats
                views={viewsLabel}
                postedAt={postedAt}
                postedAtClassName="truncate"
              />
            )}
          </div>
        </div>
      ) : gallery ? (
        <div className="pointer-events-none invisible absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pt-10 pb-3 text-white opacity-0 transition-opacity duration-150 group-hover/clip-card:visible group-hover/clip-card:opacity-100 group-has-[:focus-visible]/clip-card:visible group-has-[:focus-visible]/clip-card:opacity-100 motion-reduce:transition-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          <div className="truncate text-sm leading-5 font-semibold">
            {titleButton}
          </div>
          {showAttributionRow ? (
            <div className="flex min-w-0 items-center gap-2 text-xs">
              {smallAuthor ? (
                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  {smallAuthor}
                </span>
              ) : null}
              {smallAuthor && gameLabel ? (
                <MetaSeparator className="text-white/50" />
              ) : null}
              {gameLabel}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-4 text-white/70 [&_span]:text-inherit">
            {metaContent ?? (
              <ClipCardStats views={viewsLabel} postedAt={postedAt} />
            )}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-rows-[auto_auto] gap-x-2 md:grid-rows-[auto_auto_auto]",
            author
              ? "grid-cols-[auto_minmax(0,1fr)_auto]"
              : "grid-cols-[minmax(0,1fr)_auto]",
          )}
        >
          {author ? (
            <ClipCardAvatar
              author={author}
              authorImage={authorImage}
              authorAvatarBg={authorAvatarBg}
              authorAvatarFg={authorAvatarFg}
              href={authorHref}
              renderLink={renderAuthorLink}
              className="row-span-2 mt-0.5 size-9"
            />
          ) : null}
          <div className="text-foreground col-span-2 truncate text-lg leading-6 font-semibold">
            {titleButton}
          </div>
          {/* Phones share one line between the attribution and the stats,
              and drop the stats to a line of their own when both don't fit,
              rather than squeezing the names down to an ellipsis. Wider
              layouts give the stats their own row. */}
          <div
            className={cn(
              "col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 md:contents",
              author ? "col-start-2" : "col-start-1",
            )}
          >
            {showAttributionRow ? (
              <div className="text-foreground-dim flex max-w-full min-w-0 items-center gap-1.5 text-base leading-5">
                {author ? (
                  <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                    <AuthorLabel
                      author={author}
                      href={authorHref}
                      renderLink={renderAuthorLink}
                    />
                    {gameLabel ? (
                      <>
                        <MetaSeparator className="text-foreground-faint" />
                        {gameLabel}
                      </>
                    ) : null}
                  </span>
                ) : (
                  gameLabel
                )}
              </div>
            ) : null}
            <div
              className={cn(
                "text-foreground-faint flex max-w-full min-w-0 items-center gap-1.5 text-sm leading-5 tabular-nums md:mt-0.5",
                author
                  ? "md:col-span-2 md:col-start-2 md:row-start-3"
                  : "md:col-span-2 md:col-start-1 md:row-start-3",
              )}
            >
              {metaContent ?? (
                <ClipCardStats
                  views={viewsLabel}
                  postedAt={postedAt}
                  postedAtClassName="shrink-0"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

/** Default meta row: "12 views · 3 days ago", skipping whichever is absent. */
function ClipCardStats({
  views,
  postedAt,
  postedAtClassName,
}: {
  views: string | null
  postedAt: string | undefined
  postedAtClassName?: string
}) {
  return (
    <>
      {views ? <span className="shrink-0">{views}</span> : null}
      {views && postedAt ? <MetaSeparator /> : null}
      {postedAt ? <span className={postedAtClassName}>{postedAt}</span> : null}
    </>
  )
}

function MetaSeparator({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("shrink-0", className)}>
      ·
    </span>
  )
}

/**
 * Renders a label through the caller's router link, a plain anchor, or
 * nothing when the label has no destination.
 */
function renderLabelLink(
  renderLink: ClipCardLabelLinkRenderer | undefined,
  href: string | null | undefined,
  link: Pick<ClipCardLabelLinkProps, "className" | "children" | "ariaLabel">,
): ReactNode {
  if (renderLink) {
    return renderLink({
      ...link,
      href: href ?? undefined,
      onClick: stopLabelLinkPropagation,
    })
  }
  if (!href) return null
  return (
    <a
      href={href}
      aria-label={link.ariaLabel}
      onClick={stopLabelLinkPropagation}
      className={link.className}
    >
      {link.children}
    </a>
  )
}

function AuthorLabel({
  author,
  href,
  renderLink,
}: {
  author: string
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
}) {
  const className = cn(
    "min-w-0 shrink truncate leading-5 font-medium text-foreground-muted group-data-[gallery=true]/clip-card:text-white/85",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  return (
    renderLabelLink(renderLink, href, { className, children: author }) ?? (
      <span className={className}>{author}</span>
    )
  )
}

function ClipCardAvatar({
  author,
  authorImage,
  authorAvatarBg,
  authorAvatarFg,
  href,
  renderLink,
  className,
  size = "lg",
}: {
  author: string
  authorImage: string | null | undefined
  authorAvatarBg: string | undefined
  authorAvatarFg: string | undefined
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
  className?: string
  size?: "sm" | "lg"
}) {
  const avatarStyle = {
    background: authorAvatarBg,
    color: authorAvatarFg,
  }

  const avatar = (
    <Avatar aria-hidden size={size} className={className} style={avatarStyle}>
      {authorImage ? <AvatarImage src={authorImage} alt="" /> : null}
      <AvatarFallback style={avatarStyle} />
    </Avatar>
  )

  const linkClassName = cn(
    className,
    "rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
  )

  return (
    renderLabelLink(renderLink, href, {
      className: linkClassName,
      ariaLabel: author,
      children: avatar,
    }) ?? avatar
  )
}

function ClipCardTitleButton({
  title,
  label,
  onClick,
  onIntent,
  children,
}: {
  title: string
  label: string | undefined
  onClick: (() => void) | undefined
  onIntent: (() => void) | undefined
  children: ReactNode
}) {
  if (!onClick) return children

  return (
    <button
      type="button"
      aria-label={label ?? title}
      className="block max-w-full truncate text-left hover:underline focus-visible:underline focus-visible:outline-none"
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
    >
      {children}
    </button>
  )
}

function GameLabel({
  game,
  icon,
  href,
  renderLink,
}: {
  game: string
  icon: string | null | undefined
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
}) {
  const className = cn(
    "inline-flex min-w-0 items-center gap-1.5 truncate leading-5 text-accent group-data-[gallery=true]/clip-card:text-white/85 group-data-[compact=true]/clip-card:text-foreground-muted group-data-[compact=true]/clip-card:hover:text-accent",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  const content = (
    <>
      <GameIcon src={icon} name={game} size="sm" />
      <span className="truncate">{game}</span>
    </>
  )
  return (
    renderLabelLink(renderLink, href, { className, children: content }) ?? (
      <span className={className}>{content}</span>
    )
  )
}

function stopLabelLinkPropagation(event: MouseEvent<HTMLAnchorElement>) {
  event.stopPropagation()
}

export { ClipCard, type ClipCardLabelLinkRenderer }
