type StatInlineProps = {
  value: number
  label: string
}

export function StatInline({ value, label }: StatInlineProps) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-sm font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-xs text-foreground-faint uppercase tracking-wide">
        {label}
      </span>
    </span>
  )
}
