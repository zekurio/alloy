import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "alloy-ui/lib/utils"

/**
 * Alloy Switch — 36×20 pill (28×16 in `sm`), tokenised so the thumb animates on
 * the accent track.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & { size?: "default" | "sm" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full",
        "bg-neutral-200 transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)]",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "aria-invalid:ring-2 aria-invalid:ring-destructive",
        "data-checked:bg-accent",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "data-[size=default]:h-5 data-[size=default]:w-9",
        "data-[size=sm]:h-4 data-[size=sm]:w-7",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-neutral-700",
          "transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)]",
          "group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3",
          "ml-[2px]",
          "group-data-[size=default]/switch:group-data-checked/switch:translate-x-4",
          "group-data-[size=sm]/switch:group-data-checked/switch:translate-x-3",
          "group-data-checked/switch:bg-accent-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
