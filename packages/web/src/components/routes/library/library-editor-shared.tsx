import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Link } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"

export function BackToLibraryButton() {
  return (
    <Button variant="secondary" render={<Link to="/library" />}>
      <ArrowLeftIcon />
      {t("Back to library")}
    </Button>
  )
}
