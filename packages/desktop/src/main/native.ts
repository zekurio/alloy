import type { NativeJson } from "../shared/ipc"

/**
 * The `alloy-desktop-native` addon (`packages/desktop/native`). Keep these
 * declarations in step with its `#[napi]` exports. Rejections carry the
 * Rust code's fixed, translatable messages.
 */
export interface NativeAddon {
  initLogging(directory: string): void
  log(level: LogLevel, message: string): void
  flushLog(): void
  /** The canonical origin of a server URL; throws why it is not acceptable. */
  normalizeServerOrigin(input: string): string
  /** Validates the URL and the server's HTTP and bridge contracts. */
  prepareServer(input: string): Promise<PreparedServer>
  /** Rejects unless the file matches its minisign release signature. */
  verifyUpdateSignature(
    publicKey: string,
    signature: string,
    path: string,
  ): Promise<void>
  Preferences: new (stateDirectory: string) => NativePreferences
  startBrowserSignIn(server: string): Promise<NativeBrowserSignIn>
  createRuntime(
    folders: RuntimeFolders,
    onEvent: (event: NativeJson) => void,
  ): Promise<NativeRuntime>
}

export type LogLevel = "info" | "warn" | "error"

export interface PreparedServer {
  /** The server origin, e.g. `https://alloy.example`. */
  origin: string
  version: string
}

export interface WindowState {
  width: number
  height: number
  maximized: boolean
}

export interface NativePreferences {
  servers(): NativeJson
  currentServer(): string | null
  rememberServer(server: string, version: string): NativeJson
  forgetServer(server: string): NativeJson
  windowState(): WindowState | null
  rememberWindowState(state: WindowState): WindowState
  clampWindowState(state: WindowState): WindowState
}

export interface SessionToken {
  token: string
  /** Seconds since the Unix epoch. */
  expiresAt: number
}

export interface NativeBrowserSignIn {
  readonly authorizeUrl: string
  finish(): Promise<SessionToken>
  cancel(): void
}

export interface RuntimeFolders {
  dataDir: string
  cacheDir: string
  replayScratchDir: string
  defaultOutputDir: string
  nativeRoot: string
}

export interface NativeRuntime {
  start(): void
  invoke(operation: string, argsJson: string): Promise<NativeJson>
  selectServer(server: string | null): Promise<void>
  revealPath(id: string): Promise<string>
  stageImport(path: string): Promise<NativeJson>
  setOutputFolder(folder: string): Promise<NativeJson>
  downloadClip(
    server: string,
    cookie: string,
    requestJson: string,
  ): Promise<NativeJson>
  notificationSoundsFolder(event: string): string
  trigger(action: CaptureAction): void
  shutdown(): Promise<void>
  resumeAfterFailedUpdate(): Promise<void>
}

export type CaptureAction = "clip" | "screenshot"

/** Loads the addon. `process.dlopen` keeps the bundler away from it. */
export function loadNativeAddon(path: string): NativeAddon {
  const module = { exports: {} }
  process.dlopen(module, path)
  // SAFETY: The file is the addon built from packages/desktop/native, whose
  // exports the interface above declares.
  return module.exports as NativeAddon
}
