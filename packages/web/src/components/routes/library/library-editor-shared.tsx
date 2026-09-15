import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"

import { useLibrarySearch } from "./library-entry-navigation"

export function BackToLibraryButton() {
  const search = useLibrarySearch()
  return (
    <Button variant="secondary" render={<Link to="/library" search={search} />}>
      <ArrowLeftIcon />
      {t("Back to library")}
    </Button>
  )
}
