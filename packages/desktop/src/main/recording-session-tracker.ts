import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { RecordingEvent, RecordingGame } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

const logger = createLogger("sessions")

/**
 * Tracks one local "play session" per detected game run (game-started →
 * game-ended), keyed by process id so concurrent games stay separate.
 * Captures get stamped with the active session id as they finalize; the sync
 * engine uses ended sessions to decide what to upload and mirrors them to the
 * server as game_session rows (client-generated id = idempotent upsert).
 */

export interface LocalGameSession {
  id: string
  gameName: string
  processId: number
  startedAt: string
  endedAt: string | null
  /** Whether the server upsert (with endedAt) has succeeded. */
  syncedToServer: boolean
}

interface SessionsFile {
  version: 1
  sessions: Record<string, LocalGameSession>
}

type SessionEndedListener = (session: LocalGameSession) => void

/** Closed sessions linger this long so late-finalizing captures still stamp. */
const ENDED_STAMP_GRACE_MS = 2 * 60 * 1000

/** Ended-and-synced sessions older than this get pruned from the file. */
const SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

const sessions = new Map<string, LocalGameSession>()
const sessionEndedListeners = new Set<SessionEndedListener>()
let loaded = false

/**
 * `subscribe` is `onRecordingEvent` from recording.ts, passed in by the
 * startup wiring so this module stays import-cycle-free (the capture store
 * imports it for session stamping, and recording.ts imports the store).
 */
export function registerRecordingSessionTracking(
  subscribe: (listener: (event: RecordingEvent) => void) => void,
): void {
  loadSessions()
  subscribe((event) => {
    if (event.type === "game-started") {
      openSession(event.game)
    } else if (event.type === "game-ended") {
      const session = closeSession(event.game)
      if (session) {
        for (const listener of sessionEndedListeners) listener({ ...session })
      }
    }
  })
}

export function onGameSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener)
  return () => sessionEndedListeners.delete(listener)
}

/**
 * The session a finalizing capture belongs to. Matches the open session for
 * the capture's process, falling back to a just-ended one (replay saves can
 * finalize moments after the game exits).
 */
export function activeSessionIdForGame(
  game: RecordingGame | null,
): string | null {
  if (!game) return null
  loadSessions()

  let fallback: LocalGameSession | null = null
  for (const session of sessions.values()) {
    const matches =
      session.processId === game.processId || session.gameName === game.name
    if (!matches) continue
    if (session.endedAt === null) return session.id
    if (Date.now() - Date.parse(session.endedAt) <= ENDED_STAMP_GRACE_MS) {
      fallback = pickLater(fallback, session)
    }
  }
  return fallback?.id ?? null
}

export function getLocalGameSession(id: string): LocalGameSession | null {
  loadSessions()
  const session = sessions.get(id)
  return session ? { ...session } : null
}

export function markGameSessionSynced(id: string): void {
  loadSessions()
  const session = sessions.get(id)
  if (!session || session.syncedToServer) return
  session.syncedToServer = true
  persistSessions()
}

function openSession(game: RecordingGame): void {
  loadSessions()
  // The same process restarting detection (focus churn) must not fork a new
  // session while one is still open for it.
  for (const session of sessions.values()) {
    if (session.endedAt === null && session.processId === game.processId) {
      return
    }
  }
  const session: LocalGameSession = {
    id: randomUUID(),
    gameName: game.name,
    processId: game.processId,
    startedAt: game.startedAt ?? new Date().toISOString(),
    endedAt: null,
    syncedToServer: false,
  }
  sessions.set(session.id, session)
  persistSessions()
}

function closeSession(game: RecordingGame): LocalGameSession | null {
  loadSessions()
  for (const session of sessions.values()) {
    if (session.endedAt === null && session.processId === game.processId) {
      session.endedAt = new Date().toISOString()
      persistSessions()
      return session
    }
  }
  return null
}

function loadSessions(): void {
  if (loaded) return
  loaded = true

  let fileMtimeIso = new Date().toISOString()
  try {
    fileMtimeIso = new Date(statSync(sessionsPath()).mtimeMs).toISOString()
  } catch {
    // First run — no file yet.
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(sessionsPath(), "utf8"))
    const record = parsed as SessionsFile | null
    if (record?.version !== 1 || typeof record.sessions !== "object") return
    let mutated = false
    for (const session of Object.values(record.sessions)) {
      // Crash recovery: a session still open from a previous run ended, at
      // the latest, when this file was last written.
      if (session.endedAt === null) {
        session.endedAt = fileMtimeIso
        mutated = true
      }
      if (
        session.syncedToServer &&
        Date.now() - Date.parse(session.endedAt) > SESSION_RETENTION_MS
      ) {
        mutated = true
        continue
      }
      sessions.set(session.id, session)
    }
    if (mutated) persistSessions()
  } catch {
    // Missing or corrupt file — start clean.
  }
}

function persistSessions(): void {
  const file: SessionsFile = {
    version: 1,
    sessions: Object.fromEntries(sessions),
  }
  try {
    const path = sessionsPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
  } catch (cause) {
    logger.warn("failed to persist game sessions:", cause)
  }
}

function sessionsPath(): string {
  return join(app.getPath("userData"), "game-sessions.json")
}

function pickLater(
  a: LocalGameSession | null,
  b: LocalGameSession,
): LocalGameSession {
  if (!a) return b
  return Date.parse(b.endedAt ?? b.startedAt) >
    Date.parse(a.endedAt ?? a.startedAt)
    ? b
    : a
}
