import { formatCount } from "@/lib/number-format"

type StatInlineProps = {
  value: number
  label: string
}

export function StatInline({ value, label }: StatInlineProps) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className="text-sm font-semibold text-foreground tabular-nums"
        title={value.toLocaleString()}
      >
        {formatCount(value)}
      </span>
      <span className="text-xs font-semibold tracking-wide text-foreground-muted uppercase">
        {label}
      </span>
    </span>
  )
}
