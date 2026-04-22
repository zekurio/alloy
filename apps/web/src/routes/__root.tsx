import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import { Toaster } from "@workspace/ui/components/sonner"
import appCss from "@workspace/ui/globals.css?url"

import { MobileWarningBanner } from "@/components/layout/mobile-warning-banner"

export const Route = createRootRoute({
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
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <MobileWarningBanner />
        {children}
        {/* Global toast portal — rendered once at the root so every route
            can call `toast.*` without mounting its own provider. */}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
