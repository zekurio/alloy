import { expect, test } from "vitest"

import { DesktopTauriSavedServersSchema } from "./desktop-tauri"

test("saved servers accept older hosts and retain versions from newer hosts", () => {
  const legacy = {
    serverUrl: "https://clips.example.com",
    lastConnectedAt: "2026-06-01T10:00:00Z",
    httpContract: 1,
    bridgeContract: 1,
  }
  const versioned = { ...legacy, serverVersion: "0.0.7" }

  expect(DesktopTauriSavedServersSchema.parse([legacy, versioned])).toEqual([
    legacy,
    versioned,
  ])
  for (const serverVersion of ["", "  ", null, 7]) {
    expect(
      DesktopTauriSavedServersSchema.safeParse([{ ...legacy, serverVersion }])
        .success,
    ).toBe(false)
  }
})
