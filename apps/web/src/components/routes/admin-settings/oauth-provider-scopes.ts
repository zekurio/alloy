import { normalizeScopes } from "./shared"

function scopeInputValue(scopes: string[] | undefined): string {
  return scopes?.join(" ") ?? ""
}

function parseScopes(raw: string): string[] | undefined {
  return normalizeScopes(raw.split(/[\s,]+/))
}

export { parseScopes, scopeInputValue }
