# @alloy/contracts

Shared TypeScript contracts for Alloy. This package is the source of truth for
types that cross package or process boundaries: API payloads, admin/runtime
config shapes, and desktop recording types.

## Layout

```text
packages/contracts/
  src/index.ts                       public barrel
  src/shared.ts                      shared primitives
  src/admin.ts                       admin/runtime config contracts
  src/content.ts                     clip/content contracts
  src/desktop-recording*.ts          desktop recorder contracts
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
