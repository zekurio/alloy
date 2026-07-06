import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "admin users pagination postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("admin-users-pagination")

  // Dynamic imports are required here because DB modules read DATABASE_URL at
  // module load time, after prepareTestDatabase installs the isolated test URL.
  const { selectAdminUserStoragePage } = await import("./admin-helpers")
  const { createUserIdentity } = await import("@alloy/server/auth/identity")
  const { user } = await import("@alloy/db/auth-schema")
  const { db, client } = await import("@alloy/server/db/index")
  const { eq, sql } = await import("drizzle-orm")

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(user)
  })

  test("paginates without duplicates or skips", async () => {
    const seeded = await seedUsers()
    const expectedIds = seeded.map(({ id }) => id)
    const cursorCreatedAtById = new Map(
      seeded.map(({ id, cursorCreatedAt }) => [id, cursorCreatedAt]),
    )
    const pages: Array<{
      ids: string[]
      nextCursor: { createdAt: string; id: string } | null
    }> = []

    let cursor: { createdAt: string; id: string } | null = null
    for (;;) {
      const page = await selectAdminUserStoragePage({ cursor, limit: 3 })
      pages.push({
        ids: page.users.map(({ id }) => id),
        nextCursor: page.nextCursor,
      })
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }

    const actualIds = pages.flatMap(({ ids }) => ids)
    assert.deepEqual(actualIds, expectedIds)
    assert.equal(new Set(actualIds).size, actualIds.length)
    assert.deepEqual(new Set(actualIds), new Set(expectedIds))

    assert.deepEqual(
      pages.map(({ ids, nextCursor }) => ({
        length: ids.length,
        hasNextCursor: nextCursor !== null,
      })),
      [
        { length: 3, hasNextCursor: true },
        { length: 3, hasNextCursor: true },
        { length: 1, hasNextCursor: false },
      ],
    )

    for (const [index, page] of pages.entries()) {
      if (index === pages.length - 1) {
        assert.equal(page.nextCursor, null)
        continue
      }

      const lastId = page.ids.at(-1)
      assert.ok(lastId)
      assert.deepEqual(page.nextCursor, {
        createdAt: cursorCreatedAtById.get(lastId),
        id: lastId,
      })
    }
  })

  test("single page when limit covers all", async () => {
    const seeded = await seedUsers()

    const page = await selectAdminUserStoragePage({ cursor: null, limit: 100 })

    assert.deepEqual(
      page.users.map(({ id }) => id),
      seeded.map(({ id }) => id),
    )
    assert.equal(page.nextCursor, null)
  })

  test("enriched fields", async () => {
    const seeded = await seedUsers()

    const page = await selectAdminUserStoragePage({ cursor: null, limit: 1 })
    const [row] = page.users
    assert.ok(row)

    const expected = seeded[0]
    assert.equal(row.id, expected.id)
    assert.equal(row.username, expected.username)
    assert.equal(row.email, expected.email)
    assert.equal(row.storageUsedBytes, 0)
    assert.equal(row.clipCount, 0)
    assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  async function seedUsers() {
    const createdAtByIndex = [
      new Date("2025-01-01T12:06:00.000Z"),
      new Date("2025-01-01T12:05:00.000Z"),
      new Date("2025-01-01T12:04:00.000Z"),
      new Date("2025-01-01T12:04:00.000Z"),
      new Date("2025-01-01T12:03:00.000Z"),
      new Date("2025-01-01T12:02:00.000Z"),
      new Date("2025-01-01T12:01:00.000Z"),
    ]

    const rows = []
    for (const [index, createdAt] of createdAtByIndex.entries()) {
      const created = await createUserIdentity({
        email: `admin-user-page-${index}@example.com`,
        username: `adminuserpage${index}`,
      })
      await db
        .update(user)
        .set({ created_at: createdAt })
        .where(eq(user.id, created.id))
      const [stored] = await db
        .select({ createdAtText: sql<string>`${user.created_at}::text` })
        .from(user)
        .where(eq(user.id, created.id))
        .limit(1)
      assert.ok(stored)
      rows.push({
        id: created.id,
        email: created.email,
        username: created.username,
        createdAt,
        cursorCreatedAt: stored.createdAtText,
      })
    }

    return rows.sort(compareExpectedUserOrder)
  }

  function compareExpectedUserOrder(
    left: { id: string; createdAt: Date },
    right: { id: string; createdAt: Date },
  ) {
    const byCreatedAt = right.createdAt.getTime() - left.createdAt.getTime()
    if (byCreatedAt !== 0) return byCreatedAt
    if (left.id === right.id) return 0
    return left.id < right.id ? 1 : -1
  }
}
