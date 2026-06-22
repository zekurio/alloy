import { initializeClientLocale, t } from "@alloy/i18n"
import { initTheme } from "@alloy/ui/lib/theme"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"

import "./styles.css"

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

initializeClientLocale()
// The CSP-safe pre-paint script sets the initial class; initTheme keeps
// "system" synced with OS theme changes after React starts.
initTheme()
document.title = t("Connect to Alloy")

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
