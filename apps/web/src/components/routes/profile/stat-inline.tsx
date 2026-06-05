import { formatCount } from "@/lib/number-format"

type StatInlineProps = {
  value: number
  label: string
}

export function StatInline({ value, label }: StatInlineProps) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className="text-foreground text-sm font-semibold tabular-nums"
        title={value.toLocaleString()}
      >
        {formatCount(value)}
      </span>
      <span className="text-foreground-muted text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
    </span>
  )
}
