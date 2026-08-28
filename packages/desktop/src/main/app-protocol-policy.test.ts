import assert from "node:assert/strict"
import test from "node:test"

import {
  APP_ORIGIN,
  appProxyUrlForSelectedServerResource,
  forwardedProxyRequestHeaders,
  isAllowedProxyOrigin,
  isRejectedProxyRedirect,
  isTrustedAppDocumentUrl,
  mapAppRequest,
  normalizeSelectedServerUrl,
  requestedPreflightHeadersAreAllowed,
  selectedServerResourceUrl,
  translateSelectedServerUploadTicket,
} from "./app-protocol-policy"

const SERVER = "https://alloy.example"

test("allows HTTPS and standards-defined loopback HTTP only", () => {
  assert.equal(
    normalizeSelectedServerUrl("https://alloy.example/path"),
    "https://alloy.example",
  )
  assert.equal(
    normalizeSelectedServerUrl("http://dev.alloy.localhost:2552/path"),
    "http://dev.alloy.localhost:2552",
  )
  assert.equal(
    normalizeSelectedServerUrl("http://127.0.0.42:2552"),
    "http://127.0.0.42:2552",
  )
  assert.equal(normalizeSelectedServerUrl("http://192.168.1.10:2552"), null)
})

test("maps only app-host API requests to the selected server", () => {
  assert.deepEqual(
    mapAppRequest("alloy-app://app/api/clips?id=7", "POST", SERVER),
    {
      kind: "api",
      targetUrl: "https://alloy.example/api/clips?id=7",
    },
  )
  assert.deepEqual(
    mapAppRequest(
      "alloy-app://app/api/clips?target=https://evil.example",
      "GET",
      SERVER,
    ),
    {
      kind: "api",
      targetUrl: "https://alloy.example/api/clips?target=https://evil.example",
    },
  )
  assert.equal(
    mapAppRequest("alloy-app://evil.example/api/clips", "GET", SERVER).kind,
    "reject",
  )
  assert.equal(
    mapAppRequest("alloy-app://app.evil/api/clips", "GET", SERVER).kind,
    "reject",
  )
  assert.equal(
    mapAppRequest("alloy-app://app/apiary", "GET", SERVER).kind,
    "file",
  )
  assert.deepEqual(
    mapAppRequest("alloy-app://app/api/clips", "TRACE", SERVER),
    {
      kind: "reject",
      status: 405,
      reason: "method-not-allowed",
    },
  )
})

test("rejects traversal and malformed path encodings", () => {
  const attacks = [
    "alloy-app://app/../secret.txt",
    "alloy-app://app/%2e%2e/secret.txt",
    "alloy-app://app/assets/%2E%2E/secret.txt",
    "alloy-app://app/assets/%2f..%2fsecret.txt",
    "alloy-app://app/assets/%5c..%5csecret.txt",
    "alloy-app://app/assets/%zz.js",
    "alloy-app://app/assets\\..\\secret.txt",
    "alloy-app://app/assets/%00.js",
  ]
  for (const url of attacks) {
    const route = mapAppRequest(url, "GET", SERVER)
    assert.equal(route.kind, "reject", url)
  }
})

test("returns a local document without a server but rejects API traffic", () => {
  assert.deepEqual(mapAppRequest("alloy-app://app/", "GET", null), {
    kind: "file",
    relativePath: "desktop.html",
  })
  assert.deepEqual(mapAppRequest("alloy-app://app/api/session", "GET", null), {
    kind: "reject",
    status: 503,
    reason: "missing-server",
  })
})

test("translates local and direct media URLs only for the selected server", () => {
  assert.equal(
    selectedServerResourceUrl(
      "alloy-app://app/api/clips/abc/original/file?download=1",
      SERVER,
    ),
    "https://alloy.example/api/clips/abc/original/file?download=1",
  )
  assert.equal(
    selectedServerResourceUrl(
      "https://alloy.example/api/assets/upload/ticket",
      SERVER,
    ),
    "https://alloy.example/api/assets/upload/ticket",
  )
  assert.equal(
    selectedServerResourceUrl(
      "https://other.example/api/clips/abc/original/file",
      SERVER,
    ),
    null,
  )
  assert.equal(
    selectedServerResourceUrl("alloy-app://app/not-api/media.mp4", SERVER),
    null,
  )
  assert.equal(
    appProxyUrlForSelectedServerResource(
      "https://alloy.example/api/assets/upload/ticket-1",
      SERVER,
    ),
    "alloy-app://app/api/assets/upload/ticket-1",
  )
  assert.equal(
    appProxyUrlForSelectedServerResource(
      "https://other.example/api/assets/upload/ticket-1",
      SERVER,
    ),
    null,
  )
})

test("trusts only the fixed app document or exact development document", () => {
  const devDocument = "http://127.0.0.1:5273/desktop.html"
  assert.equal(
    isTrustedAppDocumentUrl("alloy-app://app/desktop.html", null),
    true,
  )
  assert.equal(
    isTrustedAppDocumentUrl("alloy-app://app/desktop.html#/library", null),
    true,
  )
  assert.equal(
    isTrustedAppDocumentUrl("alloy-app://app/api/server-info", null),
    false,
  )
  assert.equal(
    isTrustedAppDocumentUrl("alloy-app://app/desktop.html?target=evil", null),
    false,
  )
  assert.equal(isTrustedAppDocumentUrl(devDocument, devDocument), true)
  assert.equal(
    isTrustedAppDocumentUrl("http://127.0.0.1:5274/desktop.html", devDocument),
    false,
  )
})

test("rewrites only filesystem upload tickets onto the local API proxy", () => {
  const response = {
    clipId: "clip-1",
    ticket: {
      uploadUrl: "https://alloy.example/api/assets/upload/ticket-1",
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
    },
  }
  assert.deepEqual(translateSelectedServerUploadTicket(response, SERVER), {
    ...response,
    ticket: {
      ...response.ticket,
      uploadUrl: "alloy-app://app/api/assets/upload/ticket-1",
    },
  })
  assert.deepEqual(
    translateSelectedServerUploadTicket(
      {
        ticket: {
          uploadUrl:
            "https://canonical.example/api/assets/upload/ticket-1?token=signed",
        },
      },
      SERVER,
    ),
    {
      ticket: {
        uploadUrl: "alloy-app://app/api/assets/upload/ticket-1?token=signed",
      },
    },
  )
  assert.equal(
    translateSelectedServerUploadTicket(
      { ticket: { uploadUrl: "https://alloy.example/api/admin/users" } },
      SERVER,
    ),
    null,
  )
  assert.equal(
    translateSelectedServerUploadTicket(
      { ticket: { uploadUrl: "file:///api/assets/upload/ticket-1" } },
      SERVER,
    ),
    null,
  )
})

test("accepts only the local app and exact development origin", () => {
  const devOrigin = "http://127.0.0.1:5273"
  assert.equal(isAllowedProxyOrigin(null, devOrigin), true)
  assert.equal(isAllowedProxyOrigin(APP_ORIGIN, devOrigin), true)
  assert.equal(isAllowedProxyOrigin(devOrigin, devOrigin), true)
  assert.equal(isAllowedProxyOrigin("http://127.0.0.1:5274", devOrigin), false)
  assert.equal(isAllowedProxyOrigin("https://alloy.example", devOrigin), false)
  assert.equal(isAllowedProxyOrigin(devOrigin, null), false)
})

test("forwards API headers by allowlist and pins the HTTP origin", () => {
  const headers = forwardedProxyRequestHeaders(
    new Headers({
      Accept: "text/event-stream",
      Authorization: "Bearer renderer-controlled",
      Cookie: "alloy_access=renderer-controlled",
      "Last-Event-ID": "42",
      Origin: APP_ORIGIN,
      Range: "bytes=100-200",
      "Sec-Fetch-Site": "cross-site",
      "X-Forwarded-For": "203.0.113.9",
      "X-Request-ID": "request-1",
    }),
    SERVER,
  )

  assert.deepEqual(Object.fromEntries(headers), {
    accept: "text/event-stream",
    "accept-encoding": "identity",
    "last-event-id": "42",
    origin: SERVER,
    range: "bytes=100-200",
    "sec-fetch-site": "same-origin",
    "x-request-id": "request-1",
  })
  assert.equal(
    requestedPreflightHeadersAreAllowed("content-type, range, x-request-id"),
    true,
  )
  assert.equal(
    requestedPreflightHeadersAreAllowed("content-type, authorization"),
    false,
  )
})

test("rejects redirects but preserves conditional 304 responses", () => {
  for (const status of [300, 301, 302, 303, 305, 307, 308]) {
    assert.equal(isRejectedProxyRedirect(status), true)
  }
  assert.equal(isRejectedProxyRedirect(304), false)
  assert.equal(isRejectedProxyRedirect(200), false)
})
