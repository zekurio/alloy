type StatInlineProps = {
  value: number
  label: string
}

export function StatInline({ value, label }: StatInlineProps) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-2xs tracking-[0.1em] text-foreground-faint uppercase">
        {label}
      </span>
    </span>
  )
}
