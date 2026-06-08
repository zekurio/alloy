import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createServer, type Server } from "node:http"
import { type AddressInfo } from "node:net"

import { logger } from "alloy-logging"
import { shell } from "electron"

import { injectSessionCookie } from "./session"

// Electron can't run WebAuthn/passkeys (and providers block embedded OAuth), so
// login happens in the user's real browser. This implements the RFC 8252
// loopback flow: we open the system browser at the server's desktop-authorize
// endpoint, receive a one-time code on a temporary 127.0.0.1 listener, then
// exchange it for a session we inject into the main window's cookie jar.
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export type LoginResult = { ok: true } | { ok: false; error: string }

export async function loginViaBrowser(serverUrl: string): Promise<LoginResult> {
  const state = randomUUID()
  const codeVerifier = randomBase64Url(32)
  const codeChallenge = sha256Base64Url(codeVerifier)
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/callback") {
      res.writeHead(404)
      res.end()
      return
    }
    const code = url.searchParams.get("code")
    const returnedState = url.searchParams.get("state")
    if (!code || returnedState !== state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(
        resultPage("Sign-in failed", "You can close this window.", serverUrl),
      )
      rejectCode(new Error("Invalid loopback callback."))
      return
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(
      resultPage(
        "Signed in",
        "You can close this window and return to Alloy.",
        serverUrl,
      ),
    )
    resolveCode(code)
  })

  try {
    const port = await listen(server)
    const redirectUri = `http://127.0.0.1:${port}/callback`
    const authorizeUrl = new URL("/api/auth/desktop/authorize", serverUrl)
    authorizeUrl.searchParams.set("redirect_uri", redirectUri)
    authorizeUrl.searchParams.set("state", state)
    authorizeUrl.searchParams.set("code_challenge", codeChallenge)

    await shell.openExternal(authorizeUrl.toString())

    const code = await withTimeout(codePromise, LOGIN_TIMEOUT_MS)
    const session = await exchangeCode(serverUrl, code, codeVerifier)
    await injectSessionCookie(serverUrl, session.token, session.expiresAt)
    return { ok: true }
  } catch (cause) {
    logger.error("[desktop] browser login failed:", cause)
    const timedOut = cause instanceof Error && cause.message === "timeout"
    return {
      ok: false,
      error: timedOut ? "Sign-in timed out." : "Sign-in failed.",
    }
  } finally {
    server.close()
  }
}

async function exchangeCode(
  serverUrl: string,
  code: string,
  codeVerifier: string,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(new URL("/api/auth/desktop/token", serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`)
  const body: unknown = await res.json()
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { token?: unknown }).token !== "string" ||
    typeof (body as { expiresAt?: unknown }).expiresAt !== "string"
  ) {
    throw new Error("Invalid token response.")
  }
  return body as { token: string; expiresAt: string }
}

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url")
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null
      if (address) resolve(address.port)
      else reject(new Error("Could not bind loopback port."))
    })
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function resultPage(title: string, message: string, serverUrl: string): string {
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  const logoUrl = escapeHtml(new URL("/logo.png", serverUrl).toString())

  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
:root{
  color-scheme:dark;
  --font-sans:"DM Sans Variable",ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --background:oklch(0.19 0 0);
  --foreground:oklch(0.98 0 0);
  --foreground-muted:oklch(0.8 0 0);
  --accent:#d0c4eb;
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{
  min-height:100vh;
  background:var(--background);
  color:var(--foreground);
  font-family:var(--font-sans);
  font-size:14px;
  line-height:1.5;
  font-feature-settings:"ss01","cv11";
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}
header{
  position:absolute;
  top:2rem;
  left:1.5rem;
  z-index:1;
}
.brand{
  display:inline-flex;
  align-items:center;
  gap:10px;
  color:var(--foreground);
  text-decoration:none;
}
.brand img{
  width:36px;
  height:36px;
  flex-shrink:0;
  user-select:none;
}
.brand span{
  font-family:var(--font-mono);
  font-size:20px;
  font-weight:700;
  line-height:1;
}
.shell{
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:100vh;
  padding:6rem 1.5rem;
}
main{
  width:100%;
  max-width:24rem;
  text-align:left;
}
h1{
  margin:0;
  color:var(--foreground);
  font-size:22px;
  line-height:28px;
  font-weight:600;
  letter-spacing:0;
}
p{
  margin:.375rem 0 0;
  color:var(--foreground-muted);
  font-size:13px;
  line-height:20px;
}
@media (min-width:640px){
  header{left:2.5rem}
}
</style></head>
<body><header><a class="brand" href="#"><img src="${logoUrl}" alt=""><span>alloy</span></a></header><div class="shell"><main><h1>${safeTitle}</h1><p>${safeMessage}</p></main></div></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
