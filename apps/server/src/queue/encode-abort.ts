export function abortEncode(): Error {
  const err = new Error("Encode cancelled")
  err.name = "AbortError"
  return err
}
