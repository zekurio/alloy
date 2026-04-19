import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Slider — 4px track, accent fill, 12px white thumb with accent ring.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      {...props}
    >
      <SliderPrimitive.Control
        className={cn(
          "relative flex w-full touch-none items-center select-none",
          "data-disabled:opacity-50",
          "data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col"
        )}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-neutral-200 select-none",
            "data-horizontal:h-1 data-horizontal:w-full",
            "data-vertical:h-full data-vertical:w-1"
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-accent select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            data-slot="slider-thumb"
            className={cn(
              "relative block size-3 shrink-0 rounded-full border-2 border-accent bg-foreground",
              "transition-[box-shadow] select-none",
              "after:absolute after:-inset-2",
              "hover:ring-4 hover:ring-accent-soft",
              "focus-visible:ring-4 focus-visible:ring-accent-soft focus-visible:outline-none",
              "active:ring-4 active:ring-accent-soft",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
