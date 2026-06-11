import { Link } from "@tanstack/react-router"
import { cn } from "alloy-ui/lib/utils"

/**
 * Renders a clip's structured hashtags as a row of chips, each linking to the
 * dedicated `/tags/:tag` page. Renders nothing when the clip has no tags.
 */
export function ClipTagsRow({
  tags,
  className,
}: {
  tags: string[]
  className?: string
}) {
  if (tags.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((tag) => (
        <Link
          key={tag}
          to="/tags/$tag"
          params={{ tag }}
          className={cn(
            "inline-flex h-7 items-center rounded-lg border border-border bg-surface-raised px-2.5 text-sm font-medium",
            "text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground",
          )}
        >
          #{tag}
        </Link>
      ))}
    </div>
  )
}
