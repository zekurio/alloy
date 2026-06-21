import assert from "node:assert/strict"
import test from "node:test"

import { publicSessionData } from "./security-responses"

const now = new Date("2026-06-21T12:00:00.000Z")

test("serializes auth sessions for the public API contract", () => {
  assert.deepEqual(
    publicSessionData({
      session: {
        id: "6de50336-7f27-4a38-9b64-f131a3c20dd0",
        token_hash: "hash",
        user_id: "4e2b3dcb-6b0c-4c4d-a75f-edc2ac103945",
        expires_at: now,
        ip_address: "127.0.0.1",
        user_agent: "test",
        created_at: now,
        updated_at: now,
        last_seen_at: now,
        revoked_at: null,
      },
      user: {
        id: "4e2b3dcb-6b0c-4c4d-a75f-edc2ac103945",
        email: "admin@example.com",
        email_verified: true,
        username: "admin",
        display_username: "Admin",
        image: null,
        banner: null,
        role: "admin",
        status: "active",
        disabled_at: null,
        storage_quota_bytes: null,
        created_at: now,
        updated_at: now,
      },
    }),
    {
      session: {
        id: "6de50336-7f27-4a38-9b64-f131a3c20dd0",
        userId: "4e2b3dcb-6b0c-4c4d-a75f-edc2ac103945",
        expiresAt: "2026-06-21T12:00:00.000Z",
        createdAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "2026-06-21T12:00:00.000Z",
        lastSeenAt: "2026-06-21T12:00:00.000Z",
      },
      user: {
        id: "4e2b3dcb-6b0c-4c4d-a75f-edc2ac103945",
        email: "admin@example.com",
        emailVerified: true,
        username: "admin",
        displayUsername: "Admin",
        image: null,
        banner: null,
        role: "admin",
        status: "active",
        disabledAt: null,
        storageQuotaBytes: null,
        createdAt: "2026-06-21T12:00:00.000Z",
        updatedAt: "2026-06-21T12:00:00.000Z",
      },
    },
  )
})
