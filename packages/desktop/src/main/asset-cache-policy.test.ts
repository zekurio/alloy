import assert from "node:assert/strict"
import test from "node:test"

import { isAllowedAssetSource } from "./asset-cache-policy"

const SERVER = "https://alloy.example"

test("allows only selected-server and known public game-art sources", () => {
  assert.equal(
    isAllowedAssetSource(
      "https://alloy.example/api/assets/games/icon.png?v=1",
      SERVER,
    ),
    true,
  )
  assert.equal(
    isAllowedAssetSource(
      "https://cdn2.steamgriddb.com/file/sgdb-cdn/icon/hash.png",
      SERVER,
    ),
    true,
  )
  assert.equal(
    isAllowedAssetSource(
      "https://cdn.discordapp.com/app-icons/1094412996983664680/a_game-icon.png",
      SERVER,
    ),
    true,
  )
  assert.equal(
    isAllowedAssetSource("https://alloy.example/api/users/me", SERVER),
    false,
  )
  assert.equal(
    isAllowedAssetSource("http://127.0.0.1:8080/metadata.png", SERVER),
    false,
  )
  assert.equal(
    isAllowedAssetSource("https://attacker.example/image.png", SERVER),
    false,
  )
  assert.equal(
    isAllowedAssetSource(
      "https://cdn2.steamgriddb.com/image.png?leak=value",
      SERVER,
    ),
    false,
  )
  assert.equal(
    isAllowedAssetSource(
      "https://cdn.discordapp.com/avatars/1094412996983664680/avatar.png",
      SERVER,
    ),
    false,
  )
  assert.equal(
    isAllowedAssetSource(
      "https://media.discordapp.net/app-icons/1094412996983664680/game-icon.png",
      SERVER,
    ),
    false,
  )
  assert.equal(
    isAllowedAssetSource(
      "https://cdn.discordapp.com/app-icons/1094412996983664680/game-icon.png?size=64",
      SERVER,
    ),
    false,
  )
})
