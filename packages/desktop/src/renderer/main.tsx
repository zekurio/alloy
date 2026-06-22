import { initializeClientLocale, t } from "@alloy/i18n"
import { initTheme } from "@alloy/ui/lib/theme"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"

import "./styles.css"

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

initializeClientLocale()
// Desktop's strict CSP blocks an inline pre-paint script, so the theme is
// applied here instead; the connect window is small enough that the swap is
// imperceptible.
initTheme()
document.title = t("Connect to Alloy")

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
