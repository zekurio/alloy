import * as React from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"

import "@workspace/ui/globals.css"

import { getRouter } from "./router"

const root = document.getElementById("root")

if (!root) {
  throw new Error("Missing root element")
}

createRoot(root).render(
  <React.StrictMode>
    <RouterProvider router={getRouter()} />
  </React.StrictMode>
)
