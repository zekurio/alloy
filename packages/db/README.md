# alloy-db

Drizzle database schema, migrations, and database exports for Alloy.

## Layout

```text
packages/db/
  src/schema.ts          core application schema
  src/auth-schema.ts     auth-related schema
  src/contracts.ts       DB-backed contract helpers
  src/connection.ts      connection helpers
  src/migrate.ts         migration runner
  drizzle/               generated SQL migrations and metadata
  drizzle.config.ts      Drizzle Kit config
```

## Commands

From the repository root:

```bash
pnpm --filter alloy-db build
pnpm --filter alloy-db typecheck
pnpm --filter alloy-db test
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:studio
```

The root `db:*` scripts delegate to this package.

## Local Database

Start local Postgres before running migration or push commands:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

The dev runner computes `DATABASE_URL` from Docker/Podman compose when possible
and falls back to `postgres://postgres:postgres@127.0.0.1:5432/alloy`.
Database-backed Drizzle commands use the same resolver, so `pnpm db:push`,
`pnpm db:migrate`, and `pnpm db:studio` do not need a checked-in or
hand-maintained `.env` when compose publishes Postgres on a random localhost
port.

## Guidelines

Keep schema changes paired with migrations. If a schema type is consumed across
packages, export it from this package or mirror the public shape in
`alloy-contracts` rather than recreating it locally.
