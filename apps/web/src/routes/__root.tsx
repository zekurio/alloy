import * as React from "react"
import type { QueryClient } from "@tanstack/react-query"
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"

import { Toaster } from "@workspace/ui/components/sonner"
import appCss from "@workspace/ui/globals.css?url"

import { ClientOnly } from "@/components/app/client-only"
import { ReactivateAccountPrompt } from "@/components/account/reactivate-account-prompt"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "alloy" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/alloy-logo.png" },
      { rel: "apple-touch-icon", href: "/alloy-logo.png" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <ClientOnly>
          <React.Suspense fallback={null}>
            <ReactivateAccountPrompt />
          </React.Suspense>
        </ClientOnly>
        {/* Global toast portal — rendered once at the root so every route
            can call `toast.*` without mounting its own provider. */}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}

function RootNotFound() {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-background p-6 text-foreground">
      <div className="flex max-w-sm flex-col gap-2 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-foreground-muted">
          The page you are looking for does not exist.
        </p>
      </div>
    </main>
  )
}
