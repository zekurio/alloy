import { getRuntimeLocale, setRuntimeLocale } from "@alloy/i18n"
import { toast as sonner } from "sonner"
import { expect, test, vi } from "vitest"

import { toast } from "./toast"

test("toasts dismiss from the round close button and keep an action as the only button", () => {
  const info = vi.spyOn(sonner, "info").mockReturnValue(1)
  try {
    const action = { label: "Reload", onClick: () => {} }
    toast.info("Alloy was updated", { action })
    toast.info("Alloy was updated")
    const [withAction, withoutAction] = info.mock.calls.map(([, data]) => data)
    expect(withAction).toMatchObject({ action, closeButton: true })
    expect(withoutAction).toMatchObject({ closeButton: true })
    expect(withoutAction?.action).toBeUndefined()
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
