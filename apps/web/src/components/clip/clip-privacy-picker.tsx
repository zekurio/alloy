import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import { cn } from "@workspace/ui/lib/utils"

import type { ClipPrivacy } from "@/lib/clips-api"
import { PRIVACY_OPTIONS } from "@/lib/clip-fields"

interface ClipPrivacyPickerProps {
  value: ClipPrivacy
  onChange: (value: ClipPrivacy) => void
  disabled?: boolean
  className?: string
  layout?: "inline" | "stacked"
}

function PrivacyOptionButton({
  option,
  active,
  disabled,
  onChange,
  layout,
}: {
  option: (typeof PRIVACY_OPTIONS)[number]
  active: boolean
  disabled: boolean
  onChange: (value: ClipPrivacy) => void
  layout: "inline" | "stacked"
}) {
  const Icon = option.icon

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled}
      aria-pressed={active}
      onClick={() => onChange(option.value)}
      className={cn(
        layout === "stacked"
          ? "h-auto flex-col gap-1 rounded-md px-2 py-2 text-xs"
          : "flex-1 gap-1.5 px-2",
        active
          ? "border-accent-border bg-accent-soft text-accent hover:border-accent-border hover:bg-accent-soft hover:text-accent"
          : layout === "stacked"
            ? "bg-surface-raised text-foreground-muted hover:text-foreground"
            : "bg-input text-foreground-muted hover:text-foreground"
      )}
    >
      <Icon className={layout === "stacked" ? "size-3.5" : "size-3"} />
      {option.label}
    </Button>
  )
}

export function ClipPrivacyPicker({
  value,
  onChange,
  disabled = false,
  className,
  layout = "inline",
}: ClipPrivacyPickerProps) {
  const options = PRIVACY_OPTIONS.map((option) => (
    <PrivacyOptionButton
      key={option.value}
      option={option}
      active={option.value === value}
      disabled={disabled}
      onChange={onChange}
      layout={layout}
    />
  ))

  if (layout === "stacked") {
    return (
      <div className={cn("grid grid-cols-3 gap-2", className)}>{options}</div>
    )
  }

  return (
    <ButtonGroup className={cn("w-full", className)}>{options}</ButtonGroup>
  )
}
