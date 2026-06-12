# @alloy/logging

Small shared logging facade for Alloy packages.

## Layout

```text
packages/logging/
  src/index.ts
```

## Commands

```bash
pnpm --filter @alloy/logging build
pnpm --filter @alloy/logging typecheck
```

## Guidelines

Keep this package boring. It should provide stable logging primitives without
pulling application-specific dependencies into shared packages.
