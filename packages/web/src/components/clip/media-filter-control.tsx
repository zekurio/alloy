import { MEDIA_FILTERS, type MediaFilter } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"

export function MediaFilterControl({
  value,
  onChange,
}: {
  value: MediaFilter
  onChange: (value: MediaFilter) => void
}) {
  const labels = {
    all: t("All media"),
    video: t("Clips"),
    image: t("Screenshots"),
  }
  return (
    <Select
      value={value}
      onValueChange={(selected) => {
        const next = MEDIA_FILTERS.find((kind) => kind === selected)
        if (next) onChange(next)
      }}
    >
      <SelectTrigger aria-label={t("Media type")} className="shrink-0">
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="alloy-blur">
        {MEDIA_FILTERS.map((kind) => (
          <SelectItem key={kind} value={kind}>
            {labels[kind]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
