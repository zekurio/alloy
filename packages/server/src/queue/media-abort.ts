export function abortMediaProcessing(): Error {
  const err = new Error("Clip media processing cancelled")
  err.name = "AbortError"
  return err
}
