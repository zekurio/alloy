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
      <span className="text-xs font-semibold tracking-wide text-foreground-muted uppercase">
        {label}
      </span>
    </span>
  )
}
