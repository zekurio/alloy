import { initializeClientLocale } from "@alloy/i18n"
import { initTheme } from "@alloy/ui/lib/theme"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@alloy/ui/globals.css"

import { initCustomTheme } from "./lib/custom-theme"
import { installDeploymentRecovery } from "./lib/deployment-recovery"
import { getRouter } from "./router"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Missing root element")
}

installDeploymentRecovery()
initializeClientLocale()
initTheme()
initCustomTheme()

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={getRouter()} />
  </StrictMode>,
)
