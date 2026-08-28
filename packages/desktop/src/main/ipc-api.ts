import type { IpcMainInvokeEvent } from "electron"

import type {
  DESKTOP_API_OPERATIONS,
  DesktopApiOperationMeta,
} from "@/shared/desktop-api"

import type { UntrustedInput } from "./runtime-validation"
import type { Windows } from "./windows"

type DesktopApiHandlerResult = ReturnType<
  Parameters<typeof import("electron").ipcMain.handle>[1]
>

type InvokePathsOf<T> = {
  [K in keyof T & string]: T[K] extends { kind: "event" }
    ? never
    : T[K] extends DesktopApiOperationMeta
      ? K
      : `${K}.${InvokePathsOf<T[K]>}`
}[keyof T & string]

/**
 * Dotted path of an invokable native operation. Event operations
 * (`recording.onEvent`, `updates.onState`) are excluded: they are push
 * broadcasts with no `ipcMain.handle` registration.
 */
export type DesktopApiInvokePath = InvokePathsOf<typeof DESKTOP_API_OPERATIONS>

/**
 * One native IPC handler: `guard` authenticates the sender and is applied
 * uniformly by `registerDesktopApi` before `handle` runs; `handle` validates its
 * raw renderer input and does the work.
 */
export interface DesktopApiHandler {
  guard(windows: Windows, event: IpcMainInvokeEvent): void
  handle(
    windows: Windows,
    event: IpcMainInvokeEvent,
    ...args: UntrustedInput[]
  ): DesktopApiHandlerResult
}

/**
 * Exhaustive both ways over the invokable contract paths: a path missing a
 * handler fails the merged `DesktopApiHandlerMap` in `registerDesktopApi`, and a
 * handler for an unknown path fails its fragment's
 * `satisfies DesktopApiHandlerFragment`.
 */
export type DesktopApiHandlerMap = Record<
  DesktopApiInvokePath,
  DesktopApiHandler
>

/** Per-domain-module slice of {@link DesktopApiHandlerMap}. */
export type DesktopApiHandlerFragment = Partial<DesktopApiHandlerMap>
