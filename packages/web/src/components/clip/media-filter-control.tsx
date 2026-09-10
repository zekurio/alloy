import { MEDIA_FILTERS, type MediaFilter } from "@alloy/contracts"
import { t } from "@alloy/i18n"

export function MediaFilterControl({
  value,
  onChange,
}: {
  value: MediaFilter
  onChange: (value: MediaFilter) => void
}) {
  return (
    <select
      aria-label={t("Media type")}
      value={value}
      onChange={(event) => {
        const next = MEDIA_FILTERS.find((kind) => kind === event.target.value)
        if (next) onChange(next)
      }}
      className="border-border bg-surface text-foreground focus-visible:outline-ring h-9 shrink-0 rounded-md border px-3 text-sm focus-visible:outline-2"
    >
      <option value="all">{t("All media")}</option>
      <option value="video">{t("Clips")}</option>
      <option value="image">{t("Screenshots")}</option>
    </select>
  )
}
