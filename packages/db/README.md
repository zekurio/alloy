# @alloy/db

Drizzle database schema, migrations, and database exports for Alloy.

## Layout

```text
packages/db/
  src/index.ts               package entry: createDb, dbSchema
  src/runtime/connection.ts  Postgres pool helper
  src/runtime/migrate.ts     migration runner
  src/schema/index.ts        application schema barrel ("@alloy/db/schema")
  src/schema/auth.ts         auth schema ("@alloy/db/auth-schema")
  src/schema/game.ts         game + game-follow tables
  src/schema/clip.ts         clip and its engagement tables
  src/schema/instance.ts     DB-backed instance settings
  src/schema/internal.ts     internal worker/runtime state
  src/schema/recording.ts    desktop recording metadata
  src/schema/social.ts       follow and block tables
  drizzle/                   generated SQL migrations and metadata
  drizzle.config.ts          Drizzle Kit config
```

## Commands

From the repository root:

```bash
pnpm --filter @alloy/db build
pnpm --filter @alloy/db typecheck
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:studio
```

The root `db:*` scripts delegate to this package.

## Local Database

Use a devenv shell, which runs its own Postgres and exports `DATABASE_URL`, or
provide a local Postgres yourself before running migration or push commands:

```bash
pnpm db:push
```

Drizzle commands require `DATABASE_URL` to be set. The dev scripts and devenv
shell export it automatically; non-devenv local development can set it in the
shell, `packages/db/.env`, or the shared server env file at
`packages/server/.env`. The default Podman-published local URL is
`postgres://postgres:postgres@127.0.0.1:5432/alloy`.

## Guidelines

Keep schema changes paired with migrations. If a schema type is consumed across
packages, export it from this package or mirror the public shape in
`@alloy/contracts` rather than recreating it locally.
