# Bundled desktop renderer

Status: accepted

This decision replaces the remote Electron renderer described in issue #196.

## Context

The server used to choose the JavaScript running inside Electron. The installed
preload and main process updated through the desktop release, while that
JavaScript updated with a self-hosted server. Shared TypeScript compiled the
current source tree but could not prove compatibility between released
artifacts. A whole-bridge number was rolled from 3 back to 2, so equal numbers
even described different payload behavior.

The desktop and server are still independent products. Moving version checks
around the renderer bridge would preserve the wrong release boundary.

## Decision

Electron packages a desktop build of `packages/web`. The main window loads
`alloy-app://app/desktop.html` and never loads server HTML or JavaScript.
Renderer, preload, and main process now release together.

The server continues to package the normal browser build. That build does not
activate native integration, even when an obsolete Electron shell injects a
desktop global.

The independently released contract is desktop-to-server HTTP. The server
publishes exact supported contract IDs at `GET /api/server-info`. The bundled
desktop recognizes contract 1 by exact membership. Product SemVer is
informational and does not imply capabilities.

### Native API

`window.alloyDesktop` remains a narrow privilege boundary for recording,
window controls, updates, notifications, and server selection. It is not a
versioned compatibility protocol. The renderer, preload, operation registry,
and exhaustive main-process handlers ship in one installer.

Lockstep release does not make renderer input trusted. Main still checks the
exact BrowserWindow, top-level frame, and local application document. Every
handler validates values again before filesystem, process, network, or recorder
side effects. File deletion, clip download, server changes, and update install
also require an OS-owned confirmation dialog. The renderer never receives Electron or arbitrary IPC channel
access.

### Server transport

The bundled renderer sends API, event-stream, media, range, and same-server
filesystem upload requests to `alloy-app://app/api/*`. Main maps only that path
to the selected HTTPS server, or loopback HTTP during development. The
renderer cannot supply another target origin.

Electron's persistent session performs the upstream fetch. Access and refresh
cookies stay HttpOnly in that session, including refresh rotation and logout.
The proxy forwards an allowlist of request headers, rejects upstream redirects,
strips hop-by-hop and `Set-Cookie` response headers, and streams request and
response bodies. Filesystem upload ticket paths are rewritten to the fixed
local API origin, including servers reached through an alternate hostname.
Those signed upload requests omit session cookies. Contract 1 has no external storage driver; adding one also
requires an explicit desktop CSP and CORS policy.

Remote game artwork may use `alloy-asset://` for the desktop disk cache. That
handler accepts only the selected server's game-asset path and fixed HTTPS
SteamGridDB hosts. It rejects redirects outside that set and stops reading at
10 MiB before buffering the response.

Passkey and OAuth login continue through the existing system-browser PKCE
handoff. Passkeys and OAuth account linking belong to the server web origin, so
the desktop settings page sends those management tasks to the browser rather
than attempting them under the local application origin.

### HTTP compatibility policy

Contract 1 is the `/api` behavior at this cutover. Its request fields, response
fields, errors, and side effects are immutable. Additive response fields remain
allowed where the runtime decoder ignores unknown fields. Breaking behavior
gets a new exact contract ID and a retained contract-1 route or adapter.

A current desktop must carry clients for the current and previous supported
server contract. A current server must serve the current and previous supported
desktop contract. Capability lists use exact membership, never numeric ranges
or `>=`.

The immediately preceding server already has the endpoint behavior used by
contract 1 but does not have `/api/server-info`. The new desktop accepts that
single baseline only after both checks hold:

1. `/api/server-info` returns 404.
2. The existing desktop-auth capability is exactly 1.

Any present but malformed capability document fails closed. Unknown future
contract IDs and capability fields are ignored; changed versions of known
capabilities are rejected. A successful connection stores the exact selected
contract with that server. Startup may use that cached ID so the local library
still opens offline; switching or re-adding a server always probes again.

## Cutover

No bridge 2, bridge 3, app-version adapter, or negotiated host remains in the
new source. This creates one unavoidable cutoff for an already-installed old
desktop loading the new browser build. That browser build behaves as a normal
browser and offers no native controls.

The release workflow publishes desktop updater artifacts before promoting the
server image's `latest` tag. Release notes must tell pinned-server operators to
install the new desktop first. The new desktop works with the pre-cut server's
HTTP contract, so updating in that order does not require remote-renderer
fallback.

After this release, desktop updates no longer depend on server web assets.
Server rollbacks remain safe while they retain a supported HTTP contract.

## Verification

CI checks all of the following:

- the browser build excludes active native integration;
- the Electron build contains `out/renderer/desktop.html`;
- custom-protocol paths reject traversal, foreign origins, methods, and
  redirects;
- API and media URLs map only to the selected server;
- request headers and upload tickets use fixed allowlists;
- the capability document validates at runtime and selects exact contract 1;
- the pre-cut 404 baseline is accepted, while malformed or future-only
  documents fail;
- contracts, API, server, desktop, and web tests run before production builds.

Release validation must also exercise current desktop against the prior server
image and the prior supported HTTP client against the current server. Source
compatibility alone is not evidence of release compatibility.
