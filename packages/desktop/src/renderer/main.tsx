import { initializeClientLocale, t } from "@alloy/i18n"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"

import "./styles.css"

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

initializeClientLocale()
document.title = t("Connect to Alloy")

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
