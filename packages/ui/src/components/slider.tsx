import { cn } from "@alloy/ui/lib/utils"
import { Slider } from "@base-ui/react/slider"

function SliderRoot({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  // `touch` grows the control's own box so the whole row — not just the
  // thumb's hit area — accepts a finger press.
  size = "default",
  ...props
}: Slider.Root.Props & { size?: "default" | "touch" }) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min]
  const touch = size === "touch"

  return (
    <Slider.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      {...props}
    >
      <Slider.Control
        className={cn(
          "relative flex w-full touch-none items-center select-none",
          "data-disabled:opacity-50",
          "data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
          touch && "data-horizontal:h-9",
        )}
      >
        <Slider.Track
          data-slot="slider-track"
          className={cn(
            "relative grow overflow-hidden rounded-full bg-white/20 select-none",
            touch
              ? "data-horizontal:h-1.5 data-horizontal:w-full"
              : "data-horizontal:h-1 data-horizontal:w-full",
            "data-vertical:h-full data-vertical:w-1",
          )}
        >
          <Slider.Indicator
            data-slot="slider-range"
            className="bg-accent shadow-[0_0_8px_var(--accent-glow)] select-none data-horizontal:h-full data-vertical:w-full"
          />
        </Slider.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <Slider.Thumb
            key={index}
            data-slot="slider-thumb"
            className={cn(
              "bg-accent relative block shrink-0 rounded-full",
              "transition-[box-shadow,transform] select-none",
              touch
                ? "size-4 after:absolute after:-inset-3"
                : "size-[10px] after:absolute after:-inset-2",
              "hover:scale-110 hover:ring-4 hover:ring-accent-soft",
              "focus-visible:ring-4 focus-visible:ring-accent-soft focus-visible:outline-none",
              "active:scale-110 active:ring-4 active:ring-accent-soft",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
        ))}
      </Slider.Control>
    </Slider.Root>
  )
}

export { SliderRoot as Slider }
