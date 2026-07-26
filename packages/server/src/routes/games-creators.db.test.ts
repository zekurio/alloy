import assert from "node:assert/strict"
import { after, test } from "node:test"

import { user } from "@alloy/db/auth-schema"
import { clip, game } from "@alloy/db/schema"
import { db, client } from "@alloy/server/db/index"
import { prepareTestDatabase } from "@alloy/server/db/test-database"
import { Hono } from "hono"

import { feedRoute } from "./feed"
import { gamesRoute } from "./games"

await prepareTestDatabase("games-creators")

// Dynamic imports are required here because DB modules read DATABASE_URL at
// module load time, after prepareTestDatabase installs the isolated test URL.

after(() => client.end())

const app = new Hono().route("/games", gamesRoute).route("/feed", feedRoute)

async function seedUser(username: string, disabled = false) {
  const [row] = await db
    .insert(user)
    .values({
      email: `${username}@example.test`,
      username,
      ...(disabled
        ? { status: "disabled" as const, disabled_at: new Date() }
        : {}),
    })
    .returning()
  assert.ok(row)
  return row
}

async function seedClips(
  authorId: string,
  gameId: string,
  count: number,
  overrides: Partial<Pick<typeof clip.$inferInsert, "status" | "privacy">> = {},
) {
  for (let i = 0; i < count; i++) {
    await db.insert(clip).values({
      author_id: authorId,
      title: `clip ${authorId.slice(0, 4)} ${i}`,
      game_id: gameId,
      status: overrides.status ?? "ready",
      privacy: overrides.privacy ?? "public",
    })
  }
}

const [arena] = await db
  .insert(game)
  .values({ source: "custom", name: "Seed Arena", slug: "seed-arena" })
  .returning()
const [other] = await db
  .insert(game)
  .values({ source: "custom", name: "Other Game", slug: "other-game" })
  .returning()
assert.ok(arena)
assert.ok(other)

const creatorA = await seedUser("creator-a")
const creatorB = await seedUser("creator-b")
const creatorC = await seedUser("creator-c")
const disabledUser = await seedUser("creator-disabled", true)

await seedClips(creatorA.id, arena.id, 3)
// Clips in another game must not count toward the arena's totals.
await seedClips(creatorA.id, other.id, 2)
await seedClips(creatorB.id, arena.id, 2)
// Non-public and non-ready clips are invisible to the public listing.
await seedClips(creatorB.id, arena.id, 1, { status: "pending" })
await seedClips(creatorB.id, arena.id, 1, { privacy: "private" })
await seedClips(creatorC.id, arena.id, 1)
await seedClips(disabledUser.id, arena.id, 2)

type CreatorsBody = {
  creators: Array<{ id: string; username: string; clipCount: number }>
}

test("creators ranks visible public clips only", async () => {
  const res = await app.request("/games/seed-arena/creators")
  assert.equal(res.status, 200)
  const body = (await res.json()) as CreatorsBody
  assert.deepEqual(
    body.creators.map(({ id, clipCount }) => ({ id, clipCount })),
    [
      { id: creatorA.id, clipCount: 3 },
      { id: creatorB.id, clipCount: 2 },
      { id: creatorC.id, clipCount: 1 },
    ],
  )
})

test("creators respects the limit param", async () => {
  const res = await app.request("/games/seed-arena/creators?limit=2")
  assert.equal(res.status, 200)
  const body = (await res.json()) as CreatorsBody
  assert.deepEqual(
    body.creators.map(({ id }) => id),
    [creatorA.id, creatorB.id],
  )
})

type FeedBody = { items: Array<{ authorId: string }> }

test("game feed narrows to a single author", async () => {
  const res = await app.request(
    `/feed?filter=game&gameId=${arena.id}&authorId=${creatorB.id}`,
  )
  assert.equal(res.status, 200)
  const body = (await res.json()) as FeedBody
  assert.equal(body.items.length, 2)
  for (const item of body.items) {
    assert.equal(item.authorId, creatorB.id)
  }
})

test("game feed without author returns every visible clip", async () => {
  const res = await app.request(`/feed?filter=game&gameId=${arena.id}`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as FeedBody
  assert.equal(body.items.length, 6)
})
