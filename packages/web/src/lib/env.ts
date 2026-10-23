// The API serves the web app, so API and share links use the page's origin.
export function apiOrigin(): string {
  return window.location.origin
}

export function publicOrigin(): string {
  return window.location.origin
}
