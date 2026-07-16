import type { DESKTOP_BRIDGE, DesktopBridgeMethodMeta } from "@alloy/contracts"
import type { IpcMainInvokeEvent } from "electron"

import type { Windows } from "./windows"

type InvokePathsOf<T> = {
  [K in keyof T & string]: T[K] extends { event: true }
    ? never
    : T[K] extends DesktopBridgeMethodMeta
      ? K
      : `${K}.${InvokePathsOf<T[K]>}`
}[keyof T & string]

/**
 * Dotted path of an invokable bridge member. Event members
 * (`recording.onEvent`, `updates.onState`) are excluded: they are push
 * broadcasts with no `ipcMain.handle` registration.
 */
export type DesktopBridgeInvokePath = InvokePathsOf<typeof DESKTOP_BRIDGE>

/**
 * One bridge IPC handler: `guard` authenticates the sender and is applied
 * uniformly by `registerBridge` before `handle` runs; `handle` validates its
 * raw renderer input and does the work.
 */
export interface BridgeHandler {
  guard(windows: Windows, event: IpcMainInvokeEvent): void
  handle(
    windows: Windows,
    event: IpcMainInvokeEvent,
    ...args: unknown[]
  ): unknown
}

/**
 * Exhaustive both ways over the invokable contract paths: a path missing a
 * handler fails the merged `BridgeHandlerMap` in `registerBridge`, and a
 * handler for an unknown path fails its fragment's
 * `satisfies BridgeHandlerFragment`.
 */
export type BridgeHandlerMap = Record<DesktopBridgeInvokePath, BridgeHandler>

/** Per-domain-module slice of {@link BridgeHandlerMap}. */
export type BridgeHandlerFragment = Partial<BridgeHandlerMap>
