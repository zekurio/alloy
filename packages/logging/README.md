# @alloy/logging

Small shared logging facade for Alloy packages.

## Layout

```text
packages/logging/
  src/index.ts    logger, scopes, sinks, formatters
  src/context.ts  AsyncLocalStorage key=value log context
```

## Usage

```ts
import { createLogger, runWithLogContext } from "@alloy/logging"

const log = createLogger("queue") // renders as `[queue]` / a `scope` JSON field

runWithLogContext({ clip: clipId }, () => {
  log.info("processing started") // … INFO  [queue] processing started clip=…
})
```

Console output is pretty (colored) on TTYs and plain when piped; set
`LOG_FORMAT=json` for NDJSON. Additional destinations register via
`addLogSink` — the desktop app uses this to write a log file.

## Commands

```bash
pnpm --filter @alloy/logging build
pnpm --filter @alloy/logging typecheck
```

## Guidelines

Keep this package boring. It should provide stable logging primitives without
pulling application-specific dependencies into shared packages.
