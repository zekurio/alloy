export function normalizeRole(
  role: string | null | undefined
): "admin" | "user" {
  if (role === "admin") return "admin"
  return "user"
}
