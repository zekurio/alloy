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
  Ref,
} from "react"

import { ClipCardThumb } from "./clip-card-thumb"

interface ClipCardProps extends ComponentProps<"article"> {
  title: string
  titleContent?: ReactNode
  author: string
  authorImage?: string | null
  authorInitials?: string
  authorAvatarBg?: string
  authorAvatarFg?: string
  authorHref?: string | null
  renderAuthorLink?: ClipCardLabelLinkRenderer
  game: string
  gameIcon?: string | null
  gameHref?: string | null
  renderGameLink?: ClipCardLabelLinkRenderer
  views: string
  viewCount?: number
  likes: string
  comments?: string | number
  postedAt?: string
  metaContent?: ReactNode
  thumbnail?: string
  thumbnailFallback?: string
  thumbnailBlurHash?: string | null
  thumbnailFallbackBlurHash?: string | null
  fallbackSeed?: string | number
  accentHue?: number
  streamUrl?: string
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
  thumbnailRef?: Ref<HTMLButtonElement>
  metaVariant?: "default" | "showcase"
  /**
   * Floating controls over the thumbnail's top-right corner (e.g. an actions
   * menu). Rendered as a sibling of the thumbnail button, so interactive
   * elements stay valid HTML.
   */
  thumbnailOverlay?: ReactNode
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
  className,
  title,
  titleContent,
  author,
  authorImage,
  authorInitials,
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
  // Likes and comments stay in the contract but are no longer shown on the
  // card face — the meta line mirrors the channel-style "views · age" layout.
  likes: _likes,
  comments: _comments,
  postedAt = "2h ago",
  metaContent,
  thumbnail,
  thumbnailFallback,
  thumbnailBlurHash,
  thumbnailFallbackBlurHash,
  fallbackSeed,
  // Retained on the contract for callers; fallback color is now seed-driven.
  accentHue: _accentHue,
  streamUrl,
  onThumbnailClick,
  onTitleClick,
  onThumbnailIntent,
  onTitleIntent,
  onPreviewError,
  thumbnailLabel,
  titleLabel,
  thumbnailRef,
  metaVariant = "default",
  thumbnailOverlay,
  ...props
}: ClipCardProps) {
  const showAttributionRow = Boolean(author || game)

  return (
    <article
      data-slot="clip-card"
      className={cn("group/clip-card flex flex-col gap-1.5", className)}
      {...props}
    >
      <div className="relative">
        <ClipCardThumb
          title={title}
          thumbnail={thumbnail}
          thumbnailFallback={thumbnailFallback}
          thumbnailBlurHash={thumbnailBlurHash}
          thumbnailFallbackBlurHash={thumbnailFallbackBlurHash}
          fallbackSeed={fallbackSeed ?? game}
          streamUrl={streamUrl}
          onClick={onThumbnailClick}
          onIntent={onThumbnailIntent}
          onPreviewError={onPreviewError}
          label={thumbnailLabel ?? title}
          buttonRef={thumbnailRef}
        />
        {thumbnailOverlay ? (
          <div className="absolute top-2 right-2 z-10">{thumbnailOverlay}</div>
        ) : null}
      </div>
      <div
        className={cn(
          "grid grid-rows-[auto_auto] gap-x-2",
          author
            ? "grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        {author ? (
          <ClipCardAvatar
            author={author}
            authorImage={authorImage}
            authorInitials={authorInitials}
            authorAvatarBg={authorAvatarBg}
            authorAvatarFg={authorAvatarFg}
            href={authorHref}
            renderLink={renderAuthorLink}
            className="row-span-2 mt-0.5 size-9"
          />
        ) : null}
        <div className="text-foreground col-span-2 truncate text-lg leading-6 font-semibold">
          <ClipCardTitleButton
            title={title}
            label={titleLabel}
            onClick={onTitleClick}
            onIntent={onTitleIntent}
          >
            {titleContent ?? title}
          </ClipCardTitleButton>
        </div>
        {showAttributionRow ? (
          <div className="text-foreground-dim flex min-w-0 items-center gap-1.5 text-base leading-5">
            {author ? (
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <AuthorLabel
                  author={author}
                  href={authorHref}
                  renderLink={renderAuthorLink}
                />
                {game ? (
                  <>
                    <span className="text-foreground-faint shrink-0">
                      {"·"}
                    </span>
                    <GameLabel
                      game={game}
                      icon={gameIcon}
                      href={gameHref}
                      renderLink={renderGameLink}
                    />
                  </>
                ) : null}
              </span>
            ) : (
              <GameLabel
                game={game}
                icon={gameIcon}
                href={gameHref}
                renderLink={renderGameLink}
              />
            )}
          </div>
        ) : null}
        {metaVariant === "showcase" ? null : metaContent ? (
          <div className="text-foreground-faint flex min-w-0 items-center justify-end gap-1.5 text-sm leading-5 tabular-nums">
            {metaContent}
          </div>
        ) : (
          <div className="text-foreground-faint flex shrink-0 items-center justify-end gap-1.5 text-sm leading-5 tabular-nums">
            <span className="shrink-0">
              {views} {tp(viewCountForLabel(viewCount, views), "view", "views")}
            </span>
            <span className="shrink-0">{"·"}</span>
            <span className="shrink-0">{postedAt}</span>
          </div>
        )}
      </div>
    </article>
  )
}

function viewCountForLabel(
  viewCount: number | undefined,
  formattedViews: string,
): number {
  if (viewCount !== undefined) return viewCount
  return formattedViews.trim() === "1" ? 1 : 0
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
    "min-w-0 shrink truncate leading-5 font-medium text-foreground-muted",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  if (renderLink) {
    return renderLink({
      href: href ?? undefined,
      className,
      onClick: stopLabelLinkPropagation,
      children: author,
    })
  }
  if (href) {
    return (
      <a href={href} onClick={stopLabelLinkPropagation} className={className}>
        {author}
      </a>
    )
  }
  return <span className={className}>{author}</span>
}

function ClipCardAvatar({
  author,
  authorImage,
  authorInitials,
  authorAvatarBg,
  authorAvatarFg,
  href,
  renderLink,
  className,
}: {
  author: string
  authorImage: string | null | undefined
  authorInitials: string | undefined
  authorAvatarBg: string | undefined
  authorAvatarFg: string | undefined
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
  className?: string
}) {
  const initials = authorInitials ?? (author.slice(0, 2).toUpperCase() || "?")
  const avatarStyle = {
    background: authorAvatarBg,
    color: authorAvatarFg,
  }

  const avatar = (
    <Avatar aria-hidden size="lg" className={className} style={avatarStyle}>
      {authorImage ? <AvatarImage src={authorImage} alt="" /> : null}
      <AvatarFallback style={avatarStyle}>{initials}</AvatarFallback>
    </Avatar>
  )

  const linkClassName = cn(
    className,
    "rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
  )

  if (renderLink) {
    return renderLink({
      href: href ?? undefined,
      className: linkClassName,
      onClick: stopLabelLinkPropagation,
      ariaLabel: author,
      children: avatar,
    })
  }

  if (href) {
    return (
      <a
        href={href}
        aria-label={author}
        onClick={stopLabelLinkPropagation}
        className={linkClassName}
      >
        {avatar}
      </a>
    )
  }

  return avatar
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
    "inline-flex min-w-0 items-center gap-1.5 truncate leading-5 text-accent",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  const content = (
    <>
      <GameIcon src={icon} name={game} size="sm" />
      <span className="truncate">{game}</span>
    </>
  )
  if (renderLink) {
    return renderLink({
      href: href ?? undefined,
      className,
      onClick: stopLabelLinkPropagation,
      children: content,
    })
  }
  if (href) {
    return (
      <a href={href} onClick={stopLabelLinkPropagation} className={className}>
        {content}
      </a>
    )
  }
  return <span className={className}>{content}</span>
}

function stopLabelLinkPropagation(event: MouseEvent<HTMLAnchorElement>) {
  event.stopPropagation()
}

export {
  ClipCard,
  type ClipCardLabelLinkProps,
  type ClipCardLabelLinkRenderer,
  type ClipCardProps,
}
