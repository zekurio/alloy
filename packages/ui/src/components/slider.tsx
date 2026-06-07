import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "alloy-ui/lib/utils"

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
      : [min]

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
          "data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
        )}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-white/20 select-none",
            "data-horizontal:h-1 data-horizontal:w-full",
            "data-vertical:h-full data-vertical:w-1",
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-accent shadow-[0_0_8px_var(--accent-glow)] select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            data-slot="slider-thumb"
            className={cn(
              "bg-accent relative block size-[10px] shrink-0 rounded-full",
              "transition-[box-shadow,transform] select-none",
              "after:absolute after:-inset-2",
              "hover:scale-110 hover:ring-4 hover:ring-accent-soft",
              "focus-visible:ring-4 focus-visible:ring-accent-soft focus-visible:outline-none",
              "active:scale-110 active:ring-4 active:ring-accent-soft",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
