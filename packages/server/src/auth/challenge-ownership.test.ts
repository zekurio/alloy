import assert from "node:assert/strict"
import test from "node:test"

import {
  existingAccountChallengeOwnerId,
  legacyChallengeBelongsToUser,
  oauthChallengeOwnerId,
} from "./challenge-ownership"

const USER_ID = "11ebc58a-92f9-4f9d-b88c-3e89150b7d1e"

test("only existing-account challenges publish FK ownership", () => {
  assert.equal(existingAccountChallengeOwnerId(USER_ID), USER_ID)
  assert.equal(existingAccountChallengeOwnerId(undefined), null)
  assert.equal(oauthChallengeOwnerId("link", USER_ID), USER_ID)
  assert.equal(oauthChallengeOwnerId("sign-in", USER_ID), null)
})

test("legacy cleanup preserves a UUID-shaped username sign-up challenge", () => {
  assert.equal(
    legacyChallengeBelongsToUser(
      {
        purpose: "passkey-registration",
        identifier: USER_ID,
        payloadUsername: USER_ID,
      },
      USER_ID,
    ),
    false,
  )
  assert.equal(
    legacyChallengeBelongsToUser(
      {
        purpose: "passkey-registration",
        identifier: USER_ID,
        payloadUserId: USER_ID,
      },
      USER_ID,
    ),
    true,
  )
  assert.equal(
    legacyChallengeBelongsToUser(
      { purpose: "passkey-registration", identifier: USER_ID },
      USER_ID,
    ),
    true,
  )
})
