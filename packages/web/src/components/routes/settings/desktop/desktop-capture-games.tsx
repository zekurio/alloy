import type {
  RecordingAllowedGame,
  RecordingGameProcess,
  RecordingSettings,
} from "@alloy/contracts"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { Input } from "@alloy/ui/components/input"
import { Spinner } from "@alloy/ui/components/spinner"
import {
  AppWindowIcon,
  BanIcon,
  CheckIcon,
  Gamepad2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import * as React from "react"

import { RuleGroup } from "./desktop-capture-game-rules"
import { useDesktopRecording } from "./desktop-recording-context"

type RuleMode = "allow" | "deny"

export function AllowedGamesSection({
  settings,
  busy,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const { listGameProcesses } = useDesktopRecording()
  const [pickerMode, setPickerMode] = React.useState<RuleMode | null>(null)
  const [processes, setProcesses] = React.useState<RecordingGameProcess[]>([])
  const [query, setQuery] = React.useState("")
  const [loadingProcesses, setLoadingProcesses] = React.useState(false)
  const pickerOpen = pickerMode !== null

  const selectedAllowKeys = React.useMemo(
    () => new Set(settings.allowedGames.map(allowedGameKey)),
    [settings.allowedGames],
  )
  const selectedDenyKeys = React.useMemo(
    () => new Set(settings.deniedGames.map(allowedGameKey)),
    [settings.deniedGames],
  )

  const filteredProcesses = React.useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) return processes
    return processes.filter((process) =>
      processMatchesQuery(process, trimmedQuery),
    )
  }, [processes, query])

  async function loadProcesses() {
    setLoadingProcesses(true)
    try {
      setProcesses(await listGameProcesses())
    } finally {
      setLoadingProcesses(false)
    }
  }

  React.useEffect(() => {
    if (!pickerOpen || processes.length > 0) return
    void loadProcesses()
  }, [pickerOpen, processes.length])

  async function addGame(game: RecordingAllowedGame, mode: RuleMode) {
    if (mode === "allow") {
      const allowedGames = settings.allowedGames.some((allowed) =>
        sameAllowedGame(allowed, game),
      )
        ? settings.allowedGames
        : [...settings.allowedGames, game]
      await save({
        ...settings,
        allowedGames,
        deniedGames: settings.deniedGames.filter(
          (denied) => !sameAllowedGame(denied, game),
        ),
      })
      return
    }

    const deniedGames = settings.deniedGames.some((denied) =>
      sameAllowedGame(denied, game),
    )
      ? settings.deniedGames
      : [...settings.deniedGames, game]
    await save({
      ...settings,
      allowedGames: settings.allowedGames.filter(
        (allowed) => !sameAllowedGame(allowed, game),
      ),
      deniedGames,
    })
  }

  async function removeGame(id: string, mode: RuleMode) {
    await save({
      ...settings,
      allowedGames:
        mode === "allow"
          ? settings.allowedGames.filter((game) => game.id !== id)
          : settings.allowedGames,
      deniedGames:
        mode === "deny"
          ? settings.deniedGames.filter((game) => game.id !== id)
          : settings.deniedGames,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Game detection</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            Alloy auto-detects games. Add manual rules when detection needs a
            nudge.
          </p>
        </div>
      </div>

      <RuleGroup
        title="Always record"
        description="Manual includes for games the automatic detector misses."
        games={settings.allowedGames}
        busy={busy}
        addLabel="Add include"
        addIcon={<PlusIcon className="size-3.5" />}
        emptyText="No manual includes."
        fallbackIcon={<Gamepad2Icon className="size-4" />}
        onAdd={() => setPickerMode("allow")}
        onRemove={(id) => void removeGame(id, "allow")}
      />

      <RuleGroup
        title="Never record"
        description="Manual excludes for launchers, tools, or apps that look game-like."
        games={settings.deniedGames}
        busy={busy}
        addLabel="Add exclude"
        addIcon={<PlusIcon className="size-3.5" />}
        emptyText="No manual excludes."
        fallbackIcon={<BanIcon className="size-4" />}
        onAdd={() => setPickerMode("deny")}
        onRemove={(id) => void removeGame(id, "deny")}
      />

      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
      >
        <DialogContent className="max-w-[640px]">
          <DialogHeader className="pr-14">
            <DialogTitle>
              {pickerMode === "deny"
                ? "Add manual exclude"
                : "Add manual include"}
            </DialogTitle>
          </DialogHeader>
          <DialogClose
            aria-label="Close process picker"
            className="text-foreground-dim hover:text-foreground focus-visible:ring-foreground/30 absolute top-3 right-3 z-10 inline-flex size-8 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <XIcon className="size-4" />
          </DialogClose>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="text-foreground-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search processes"
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={loadingProcesses}
                title="Refresh"
                aria-label="Refresh processes"
                onClick={() => void loadProcesses()}
              >
                {loadingProcesses ? (
                  <Spinner />
                ) : (
                  <RefreshCwIcon className="size-4" />
                )}
              </Button>
            </div>

            <div className="border-border h-[340px] overflow-y-auto overscroll-contain rounded-md border">
              {loadingProcesses && processes.length === 0 ? (
                <div className="text-foreground-muted flex h-full items-center justify-center gap-2 text-sm">
                  <Spinner />
                  Loading processes
                </div>
              ) : filteredProcesses.length > 0 ? (
                <div className="divide-border divide-y">
                  {filteredProcesses.map((process) => {
                    const game = allowedGameFromProcess(process)
                    const selected =
                      pickerMode === "deny"
                        ? selectedDenyKeys.has(allowedGameKey(game))
                        : selectedAllowKeys.has(allowedGameKey(game))
                    return (
                      <div
                        key={process.id}
                        className="flex min-h-16 items-center gap-3 px-3 py-2.5"
                      >
                        <span className="bg-surface-raised text-foreground-muted grid size-8 shrink-0 place-items-center rounded-md">
                          <ProcessIcon process={process} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {process.name}
                          </div>
                          <div className="text-foreground-dim mt-0.5 truncate text-xs">
                            {process.windowTitle ??
                              process.executable ??
                              `PID ${process.processId}`}
                          </div>
                          {process.path ? (
                            <div className="text-foreground-faint mt-0.5 truncate text-xs">
                              {process.path}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant={selected ? "secondary" : "default"}
                          size="sm"
                          disabled={busy || selected}
                          onClick={() => {
                            if (pickerMode) void addGame(game, pickerMode)
                          }}
                        >
                          {selected ? (
                            <CheckIcon className="size-3.5" />
                          ) : pickerMode === "deny" ? (
                            <BanIcon className="size-3.5" />
                          ) : (
                            <PlusIcon className="size-3.5" />
                          )}
                          {selected
                            ? "Added"
                            : pickerMode === "deny"
                              ? "Block"
                              : "Add"}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-foreground-dim flex h-full items-center justify-center px-4 text-center text-sm">
                  No matching processes found.
                </div>
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function allowedGameFromProcess(
  process: RecordingGameProcess,
): RecordingAllowedGame {
  return {
    id: process.path
      ? `path:${process.path.toLowerCase()}`
      : `process:${process.processId}`,
    name: process.name,
    executable: process.executable,
    path: process.path,
    windowClass: null,
    iconUrl: process.iconUrl,
  }
}

function ProcessIcon({ process }: { process: RecordingGameProcess }) {
  if (process.iconUrl) {
    return (
      <img
        src={process.iconUrl}
        alt=""
        draggable={false}
        className="size-5 object-contain"
      />
    )
  }

  return <AppWindowIcon className="size-4" />
}

function sameAllowedGame(
  left: RecordingAllowedGame,
  right: RecordingAllowedGame,
): boolean {
  return allowedGameKey(left) === allowedGameKey(right)
}

function allowedGameKey(game: RecordingAllowedGame): string {
  return [game.path, game.executable, game.windowClass]
    .map((value) => value?.trim().toLowerCase() ?? "")
    .join(":")
}

function processMatchesQuery(
  process: RecordingGameProcess,
  query: string,
): boolean {
  return [
    process.name,
    process.executable,
    process.path,
    process.windowTitle,
    String(process.processId),
  ].some((value) => value?.toLowerCase().includes(query))
}
