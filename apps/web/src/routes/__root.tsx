import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import { Toaster } from "@workspace/ui/components/sonner"
import appCss from "@workspace/ui/globals.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Alloy" },
    ],
    links: [
      // Font hosts — preconnect to shave the TLS handshake off the first request.
      // Kept in <head> (rather than @import in CSS) so fetching fonts doesn't
      // block CSS parsing on server-rendered TanStack Start pages.
      { rel: "preconnect", href: "https://api.fontshare.com" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      // Preload the stylesheets so the browser kicks off the fetch in parallel
      // with HTML parsing instead of waiting until it hits each <link rel="stylesheet">.
      {
        rel: "preload",
        as: "style",
        href: "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,900&display=swap",
      },
      {
        rel: "preload",
        as: "style",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,900&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
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
        {children}
        {/* Global toast portal — rendered once at the root so every route
            can call `toast.*` without mounting its own provider. */}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
