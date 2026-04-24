import { Toggle } from "@workspace/ui/components/toggle"
import { cn } from "@workspace/ui/lib/utils"

import type { ClipPrivacy } from "@workspace/api"
import { PRIVACY_OPTIONS } from "@/lib/clip-fields"

interface ClipPrivacyPickerProps {
  value: ClipPrivacy
  onChange: (value: ClipPrivacy) => void
  disabled?: boolean
  className?: string
}

function PrivacyOptionButton({
  option,
  active,
  disabled,
  onChange,
}: {
  option: (typeof PRIVACY_OPTIONS)[number]
  active: boolean
  disabled: boolean
  onChange: (value: ClipPrivacy) => void
}) {
  const Icon = option.icon

  return (
    <Toggle
      pressed={active}
      disabled={disabled}
      onClick={() => onChange(option.value)}
      className={cn(
        "h-auto flex-1 flex-col gap-1 rounded-md border px-2 py-2 text-xs",
        active
          ? "border-accent-border bg-accent-soft text-accent hover:border-accent-border hover:bg-accent-soft hover:text-accent"
          : "border-input bg-surface-raised text-foreground-muted hover:bg-surface-raised hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {option.label}
    </Toggle>
  )
}

export function ClipPrivacyPicker({
  value,
  onChange,
  disabled = false,
  className,
}: ClipPrivacyPickerProps) {
  return (
    <div className={cn("grid w-full grid-cols-3 gap-2", className)}>
      {PRIVACY_OPTIONS.map((option) => (
        <PrivacyOptionButton
          key={option.value}
          option={option}
          active={option.value === value}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  )
}
