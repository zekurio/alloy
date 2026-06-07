import { type Context, Hono } from "hono"
import { z } from "zod"

import {
  consumeDesktopLinkCode,
  createDesktopLinkCode,
} from "../auth/desktop-link"
import { createSession, getSession } from "../auth/session"
import { getSetupStatus } from "../auth/user-bootstrap"
import { badRequest } from "../runtime/http-response"
import { loopbackRedirect } from "./auth-desktop-helpers"
import { zValidator } from "./validation"

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

const DESKTOP_AUTHORIZE_PAGE_STYLE = `
:root{
  color-scheme:dark;
  --font-sans:"DM Sans Variable",ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --background:oklch(0.19 0 0);
  --foreground:oklch(0.98 0 0);
  --foreground-muted:oklch(0.8 0 0);
  --foreground-dim:oklch(0.7 0 0);
  --accent:#d0c4eb;
  --accent-hover:#e3daf5;
  --accent-active:#b3a8cf;
  --accent-foreground:#0b0a0f;
  --ring:var(--accent);
  --radius-md:6px;
  --duration-fast:120ms;
  --ease-out:cubic-bezier(0.16,1,0.3,1);
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
.panel{
  width:100%;
  max-width:24rem;
  text-align:left;
}
.copy{margin-bottom:2rem}
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
form{
  display:flex;
  flex-direction:column;
  gap:.75rem;
}
button{
  display:inline-flex;
  width:100%;
  min-height:2.25rem;
  align-items:center;
  justify-content:center;
  border:1px solid var(--accent);
  border-radius:var(--radius-md);
  background:var(--accent);
  color:var(--accent-foreground);
  font:inherit;
  font-size:13px;
  font-weight:600;
  line-height:16px;
  padding:.5rem 1rem;
  cursor:pointer;
  transition:background var(--duration-fast) var(--ease-out),border-color var(--duration-fast) var(--ease-out),box-shadow var(--duration-fast) var(--ease-out);
}
button:hover{
  border-color:var(--accent-hover);
  background:var(--accent-hover);
}
button:active{background:var(--accent-active)}
button:focus-visible{
  outline:2px solid var(--ring);
  outline-offset:2px;
}
@media (min-width:640px){
  header{left:2.5rem}
  button{min-height:2rem}
}
`

function requiredFormString(
  body: Record<string, string | File>,
  key: string,
): string | null {
  const value = body[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function authorizePage(input: {
  codeChallenge: string
  redirectUri: string
  state: string
  username: string
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorize Alloy Desktop</title>
<style>${DESKTOP_AUTHORIZE_PAGE_STYLE}</style></head>
<body><header><a class="brand" href="/"><img src="/logo.png" alt=""><span>alloy</span></a></header><div class="shell"><main class="panel"><div class="copy"><h1>Authorize Alloy Desktop</h1><p>Signed in as ${escapeHtml(input.username)}. Continue only if you opened the Alloy desktop app.</p></div>
<form method="post" action="/api/auth/desktop/authorize">
<input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}">
<input type="hidden" name="state" value="${escapeHtml(input.state)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(input.codeChallenge)}">
<button type="submit">Authorize desktop app</button>
</form></main></div></body></html>`
}

async function redirectToSetupIfRequired(c: Context): Promise<Response | null> {
  const setup = await getSetupStatus()
  return setup.setupRequired ? c.redirect("/setup", 302) : null
}

const CodeChallenge = z.string().min(32).max(128).regex(BASE64URL_RE)
const TokenBody = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(32).max(128).regex(BASE64URL_RE),
})

export const authDesktopRoute = new Hono()
  // Browser entry point. The desktop app opens this in the system browser; the
  // user authenticates with full passkey/OAuth support, then confirms linking
  // before we mint a one-time code for the app's loopback listener.
  .get("/authorize", async (c) => {
    const redirect = loopbackRedirect(c.req.query("redirect_uri"))
    const state = c.req.query("state")
    const codeChallenge = CodeChallenge.safeParse(c.req.query("code_challenge"))
    if (!redirect || !state || !codeChallenge.success) {
      return c.text("Invalid desktop login request.", 400)
    }

    const setupRedirect = await redirectToSetupIfRequired(c)
    if (setupRedirect) return setupRedirect

    const session = await getSession(c)
    if (!session || session.user.status !== "active") {
      // Not signed in yet: send them through the normal login UI, returning
      // here once a session exists (see the web `redirect` search param).
      const self = `/api/auth/desktop/authorize?redirect_uri=${encodeURIComponent(
        redirect.toString(),
      )}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(
        codeChallenge.data,
      )}`
      return c.redirect(`/login?redirect=${encodeURIComponent(self)}`, 302)
    }

    return c.html(
      authorizePage({
        codeChallenge: codeChallenge.data,
        redirectUri: redirect.toString(),
        state,
        username: session.user.displayUsername || session.user.username,
      }),
    )
  })
  .post("/authorize", async (c) => {
    const body = await c.req.parseBody()
    const redirect = loopbackRedirect(requiredFormString(body, "redirect_uri"))
    const state = requiredFormString(body, "state")
    const codeChallenge = CodeChallenge.safeParse(
      requiredFormString(body, "code_challenge"),
    )
    if (!redirect || !state || !codeChallenge.success) {
      return c.text("Invalid desktop login request.", 400)
    }

    const setupRedirect = await redirectToSetupIfRequired(c)
    if (setupRedirect) return setupRedirect

    const session = await getSession(c)
    if (!session || session.user.status !== "active") {
      return c.redirect(
        `/login?redirect=${encodeURIComponent(
          c.req.path +
            "?" +
            new URLSearchParams({
              redirect_uri: redirect.toString(),
              state,
              code_challenge: codeChallenge.data,
            }).toString(),
        )}`,
        302,
      )
    }

    const code = await createDesktopLinkCode(
      session.user.id,
      codeChallenge.data,
    )
    redirect.searchParams.set("code", code)
    redirect.searchParams.set("state", state)
    return c.redirect(redirect.toString(), 302)
  })
  // Code exchange, called server-to-server by the desktop app (no cookies).
  // Mints a fresh session distinct from the browser's, so signing out of one
  // doesn't kill the other.
  .post("/token", zValidator("json", TokenBody), async (c) => {
    const { code, codeVerifier } = c.req.valid("json")
    const userId = await consumeDesktopLinkCode(code, codeVerifier)
    if (!userId) return badRequest(c, "Invalid or expired code.")

    const { token, data } = await createSession(c, userId)
    const expiresAt = data.session.expiresAt
    if (!expiresAt) throw new Error("Session created without an expiry.")
    return c.json({ token, expiresAt: expiresAt.toISOString() })
  })
