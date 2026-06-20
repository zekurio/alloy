# @alloy/contracts

Shared TypeScript contracts for Alloy. This package is the source of truth for
types that cross package or process boundaries: API payloads, admin config
responses, desktop recording/update types, tags, and media helpers.

## Layout

```text
packages/contracts/
  src/index.ts                       public barrel
  src/shared.ts                      shared primitives
  src/admin.ts                       admin config and auth contracts
  src/blurhash.ts                    BlurHash validation helpers
  src/content.ts                     clip/content contracts
  src/tags.ts                        tag normalization contracts
  src/desktop-recording*.ts          desktop recorder contracts
  src/desktop-update.ts              desktop updater state contracts
```

## Commands

```bash
pnpm --filter @alloy/contracts build
pnpm --filter @alloy/contracts typecheck
```

## Guidelines

Put cross-boundary contracts here before wiring new behavior into clients or
server routes. Keep contracts serializable and stable; prefer additive changes
when desktop or recorder versions may lag behind the server.
