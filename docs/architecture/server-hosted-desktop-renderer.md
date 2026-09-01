# Server-hosted desktop renderer

Status: accepted

This decision supersedes the bundled renderer introduced by #197.

## Context

Alloy's browser UI and desktop UI are the same product surface. Packaging a
second web build in Electron split routing, deployment recovery, CSP, uploads,
and browser transport into desktop-specific variants. The `alloy-app://` proxy
also duplicated Chromium's cookie, redirect, streaming, range, and CORS
behavior, and failures in that translation layer could turn normal API errors
into desktop-only gateway failures.

The useful desktop boundary is narrower: a local shell selects an Alloy server,
loads its web app, and adds recording, filesystem, updater, notification, and
window capabilities.

## Decision

Electron keeps a local connect/recovery renderer, then loads the selected
server origin directly in the main BrowserWindow. The server packages the only
application renderer. The main window uses normal browser history and direct
same-origin requests for JSON, uploads, event streams, media, and cookies.
There is no Electron application HTTP proxy or bundled app entry.

System-browser PKCE login remains. It gives OAuth and passkeys a normal browser
profile, then installs the resulting HttpOnly session in the persistent main
window partition.

Two bounded native protocols remain:

- `alloy-capture://` streams local captures and extracted audio tracks with
  range and CORS support.
- `alloy-asset://` caches only allowlisted public artwork.

The server CSP declares those schemes for the desktop environment. Normal
browsers have no protocol handlers and continue using server resources.

Filesystem upload tickets are served by the Alloy origin. The server rebases
their signed path and query onto the incoming request origin, so an installation
reached through a reverse-proxy alias remains same-origin without desktop
rewriting. Future external-storage ticket URLs are left untouched.

## Native bridge boundary

The installed preload and server-hosted JavaScript can update independently.
`GET /api/server-info` therefore advertises exact native bridge contract IDs in
addition to exact desktop HTTP contract IDs. The current desktop and web app
select bridge contract 1 by equality, never by a numeric range. A breaking
change gets a new ID; contract 1 is immutable.

Before navigation, main passes the selected origin to the sandboxed preload in
a main-controlled argument. Preload exposes `window.alloyDesktop` only when the
document has that exact origin and includes its bridge contract marker. The web
app ignores absent, obsolete, and unknown bridge contracts.

Preload gating is defense in depth. Every main-process handler also requires:

1. the selected main BrowserWindow;
2. its top-level frame;
3. the exact selected server origin; and
4. runtime validation of untrusted arguments.

Cross-origin main-frame navigation leaves Electron and opens credential-free
HTTP(S) targets in the system browser. Popups follow the same rule; unsafe
schemes and credentialed URLs are denied. Renderer permission requests are
deny-by-default and allowed only for the selected top-level origin.

## Compatibility and release order

A new desktop refuses servers that omit `/api/server-info`, HTTP contract 1, or
bridge contract 1. Saved servers from the bundled era remain visible but must
be reprobed before startup. When the selected server is unavailable, the local
connect surface is the recovery UI; the server application itself is not
available offline.

At the one-time cutover, the release workflow promotes the additive server
image before publishing the new desktop updater artifacts. Existing bundled
desktops continue using HTTP contract 1 against that server. The new desktop is
published only after a bridge-capable server image is available.

Future releases must preserve a compatible overlap: current servers advertise
the bridge and HTTP contracts supported by available desktops, and desktops
must fail closed before loading an incompatible renderer.

## Verification

CI verifies that the server web artifact contains desktop bridge integration,
the Electron renderer contains only the local connect document, the preload
contains both its origin gate and bridge, and runtime tests cover exact contract
selection, origin trust, saved-server migration, and upload-ticket rebasing.
