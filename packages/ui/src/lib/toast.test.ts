import { getRuntimeLocale, setRuntimeLocale } from "@alloy/i18n"
import { toast as sonner } from "sonner"
import { expect, test, vi } from "vite-plus/test"

import { toast } from "./toast"

test("a primary action replaces the extra Close button with the native dismiss", () => {
  const info = vi.spyOn(sonner, "info").mockReturnValue(1)
  try {
    const action = { label: "Reload", onClick: () => {} }
    toast.info("Alloy was updated", { action })
    expect(info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        action,
        cancel: undefined,
        closeButton: true,
      }),
    )
  } finally {
    info.mockRestore()
  }
})
test("toast text and descriptions use the current locale", () => {
  const previous = getRuntimeLocale()
  const error = vi.spyOn(sonner, "error").mockReturnValue(1)
  try {
    setRuntimeLocale("de")
    toast.error("Could not start sign-in.", {
      description: "API server unavailable",
    })
    expect(error).toHaveBeenCalledWith(
      "Anmeldung konnte nicht gestartet werden.",
      expect.objectContaining({
        description: "Der Server ist derzeit nicht erreichbar",
      }),
    )
  } finally {
    setRuntimeLocale(previous)
    error.mockRestore()
  }
})
