import { type MediaFilter } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { ClapperboardIcon, ImageIcon, LayersIcon } from "lucide-react"

import { SortDropdown } from "./sort-dropdown"

export function MediaFilterControl({
  value,
  onChange,
}: {
  value: MediaFilter
  onChange: (value: MediaFilter) => void
}) {
  return (
    <SortDropdown
      value={value}
      options={[
        { key: "all", label: t("All media"), icon: <LayersIcon /> },
        { key: "video", label: t("Clips"), icon: <ClapperboardIcon /> },
        { key: "image", label: t("Screenshots"), icon: <ImageIcon /> },
      ]}
      renderOptionLink={(option) => (
        <button type="button" onClick={() => onChange(option.key)} />
      )}
    />
  )
}
