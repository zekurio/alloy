import { cn } from "@alloy/ui/lib/utils"

type GameLogoVariant = "card" | "header"

type GameLogoProps = {
  src: string
  name: string
  variant: GameLogoVariant
  loading?: "eager" | "lazy"
  onError?: () => void
}

const logoClasses: Record<GameLogoVariant, string> = {
  card: "h-12 max-w-[80%] object-center sm:h-14",
  header: "h-14 max-w-[min(24rem,58vw)] object-left sm:h-16",
}

export function GameLogo({
  src,
  name,
  variant,
  loading,
  onError,
}: GameLogoProps) {
  return (
    <img
      src={src}
      alt={name}
      className={cn(
        "block w-auto shrink object-contain drop-shadow-[0_2px_12px_oklch(0_0_0_/_0.65)]",
        logoClasses[variant],
      )}
      loading={loading}
      decoding="async"
      onError={onError}
    />
  )
}
