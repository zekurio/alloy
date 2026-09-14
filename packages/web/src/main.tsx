import { initializeClientLocale } from "@alloy/i18n"
import { initTheme } from "@alloy/ui/lib/theme"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@alloy/ui/globals.css"

import { installDeploymentRecovery } from "./lib/deployment-recovery"
import { getRouter } from "./router"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Missing root element")
}

installDeploymentRecovery()
initializeClientLocale()
initTheme()

const router = getRouter()

// index.html paints a boot splash until the app can show something real.
// Waiting for the first rendered route keeps it up through auth checks and
// loaders, so the shell never appears empty and then pops in.
const stopSplashWatch = router.subscribe("onRendered", () => {
  stopSplashWatch()
  const splash = document.getElementById("boot-splash")
  if (!splash) return
  splash.dataset.done = ""
  window.setTimeout(() => splash.remove(), 300)
})

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
