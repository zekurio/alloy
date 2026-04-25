function scopeInputValue(scopes: string[] | undefined): string {
  return scopes?.join(" ") ?? ""
}

function parseScopes(raw: string): string[] | undefined {
  const scopes = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
  return scopes.length > 0 ? scopes : undefined
}

export { parseScopes, scopeInputValue }
