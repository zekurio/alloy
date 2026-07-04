import type {
  AdminFailedJob,
  AdminJobKindRow,
  AdminJobsSweeps,
  AdminSweepKind,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Spinner } from "@alloy/ui/components/spinner"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"

import {
  adminFailedJobsQueryOptions,
  adminJobsSummaryQueryOptions,
  adminKeys,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"

const RENDITIONS_SWEEP_KIND = "clip.renditions-sweep"

const JOB_KIND_LABELS: Record<string, string> = {
  "clip.encode": t("Encode clip"),
  "clip.renditions-sweep": t("Rendition sweep"),
  "clip.source-probe-sweep": t("Source probe sweep"),
  "clip.source-probe": t("Source probe"),
  "clip.verify-assets": t("Verify assets"),
  "clip.verify": t("Verify clip"),
  "storage.orphan-gc": t("Storage cleanup"),
  "clip.reap-pending": t("Reap stale uploads"),
  "upload.reap-tickets": t("Reap upload tickets"),
  "clip.reconcile": t("Reconcile encodes"),
  "auth.sweep-challenges": t("Sweep sign-in challenges"),
  "jobs.prune": t("Prune job history"),
}

const SWEEP_KINDS: ReadonlySet<string> = new Set<AdminSweepKind>([
  "clip.renditions-sweep",
  "clip.verify-assets",
  "storage.orphan-gc",
])

function kindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind] ?? kind
}

export function AdminJobsCard({ hideHeader }: { hideHeader?: boolean }) {
  const summaryQuery = useQuery(adminJobsSummaryQueryOptions())
  const loadError = summaryQuery.error
    ? errorMessage(summaryQuery.error, t("Failed to load jobs"))
    : null

  const content = loadError ? (
    <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
      {loadError}
    </div>
  ) : !summaryQuery.data ? (
    <div className="text-foreground-muted grid place-items-center py-6">
      <Spinner className="size-4" />
    </div>
  ) : (
    <div className="flex flex-col gap-6">
      <SweepStats sweeps={summaryQuery.data.sweeps} />
      <KindTable kinds={summaryQuery.data.kinds} />
      <FailedJobs />
    </div>
  )

  if (hideHeader) return content

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{t("Background jobs")}</SectionTitle>
      </SectionHeader>
      <SectionContent>{content}</SectionContent>
    </Section>
  )
}

function SweepStats({ sweeps }: { sweeps: AdminJobsSweeps }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <SweepStatCard
        title={t("Renditions")}
        finishedAt={sweeps.renditionSweep?.finishedAt ?? null}
        primary={
          sweeps.renditionSweep
            ? tRenditionSweepPrimary(sweeps.renditionSweep)
            : t("Not run yet")
        }
        emphasis={
          sweeps.renditionSweep?.mode === "stale" &&
          sweeps.renditionSweep.enqueued > 0
        }
        detail={
          sweeps.renditionSweep
            ? t("{upToDate} up to date · {adopted} adopted", {
                upToDate: sweeps.renditionSweep.upToDate,
                adopted: sweeps.renditionSweep.adopted,
              })
            : null
        }
      />
      <SweepStatCard
        title={t("Storage verify")}
        finishedAt={sweeps.storageVerify?.finishedAt ?? null}
        primary={
          sweeps.storageVerify
            ? sweeps.storageVerify.repaired > 0
              ? t("{count} repaired", { count: sweeps.storageVerify.repaired })
              : t("All assets present")
            : t("Not run yet")
        }
        emphasis={(sweeps.storageVerify?.repaired ?? 0) > 0}
        detail={
          sweeps.storageVerify
            ? t("{checked} assets checked", {
                checked: sweeps.storageVerify.checked,
              })
            : null
        }
      />
      <SweepStatCard
        title={t("Storage cleanup")}
        finishedAt={sweeps.storageGc?.finishedAt ?? null}
        primary={
          sweeps.storageGc
            ? t("{count} removed", {
                count:
                  sweeps.storageGc.deletedOrphanObjects +
                  sweeps.storageGc.deletedStaleAssets,
              })
            : t("Not run yet")
        }
        detail={
          sweeps.storageGc
            ? t("{scanned} objects scanned", {
                scanned: sweeps.storageGc.scanned,
              })
            : null
        }
      />
    </div>
  )
}

function tRenditionSweepPrimary(
  sweep: NonNullable<AdminJobsSweeps["renditionSweep"]>,
): string {
  if (sweep.mode === "force") return tForcedReencoded(sweep.enqueued)
  return tStale(sweep.enqueued)
}

function tForcedReencoded(count: number): string {
  return count === 1
    ? t("{count} clip re-encoded (forced)", { count })
    : t("{count} clips re-encoded (forced)", { count })
}

function tStale(count: number): string {
  return count === 1
    ? t("{count} stale clip", { count })
    : t("{count} stale clips", { count })
}

function SweepStatCard({
  title,
  primary,
  detail,
  finishedAt,
  emphasis,
}: {
  title: string
  primary: string
  detail: string | null
  finishedAt: string | null
  emphasis?: boolean
}) {
  return (
    <div className="border-border bg-muted/20 flex flex-col gap-0.5 rounded-lg border p-3">
      <span className="text-foreground-muted text-2xs font-medium tracking-[0.06em] uppercase">
        {title}
      </span>
      <span
        className={cn(
          "text-sm font-semibold",
          emphasis ? "text-warning" : "text-foreground",
        )}
      >
        {primary}
      </span>
      {detail ? (
        <span className="text-foreground-dim text-xs">{detail}</span>
      ) : null}
      {finishedAt ? (
        <span className="text-foreground-muted text-2xs">
          {formatRelativeTime(finishedAt)}
        </span>
      ) : null}
    </div>
  )
}

function KindTable({ kinds }: { kinds: AdminJobKindRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{t("Job kinds")}</span>
      <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
        {kinds.map((row) => (
          <KindRow key={row.kind} row={row} />
        ))}
      </div>
    </div>
  )
}

function KindRow({ row }: { row: AdminJobKindRow }) {
  const queryClient = useQueryClient()

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) =>
      api.admin.setJobKindPaused(row.kind, paused),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't update job"))),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminKeys.jobsSummary() }),
  })

  const sweepMutation = useMutation({
    mutationFn: (mode: "stale" | "force") =>
      api.admin.runJobSweep(row.kind as AdminSweepKind, mode),
    onSuccess: () => toast.success(t("Job started")),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't start job"))),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminKeys.jobsSummary() }),
  })

  const scheduleHint = row.schedule
    ? row.schedule.nextRunAt
      ? t("Next {when}", { when: formatRelativeTime(row.schedule.nextRunAt) })
      : t("Scheduled")
    : t("On demand")

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {kindLabel(row.kind)}
          </span>
          <Badge variant="outline" className="shrink-0 text-xs">
            {row.queue}
          </Badge>
        </div>
        <span className="text-foreground-muted text-xs">{scheduleHint}</span>
      </div>

      <div className="flex items-center gap-3">
        <CountPill label={t("Pending")} value={row.pending} />
        <CountPill
          label={t("Running")}
          value={row.running}
          tone={row.running > 0 ? "active" : "muted"}
        />
        <CountPill
          label={t("Failed")}
          value={row.failed}
          tone={row.failed > 0 ? "danger" : "muted"}
        />
      </div>

      <div className="flex items-center gap-2">
        {SWEEP_KINDS.has(row.kind) ? (
          <RunNowAction
            kind={row.kind}
            pending={sweepMutation.isPending}
            onRun={(mode) => sweepMutation.mutate(mode)}
          />
        ) : null}
        <Switch
          checked={!row.paused}
          disabled={pauseMutation.isPending}
          aria-label={row.paused ? t("Resume") : t("Pause")}
          onCheckedChange={(next) => pauseMutation.mutate(!next)}
        />
      </div>
    </div>
  )
}

function RunNowAction({
  kind,
  pending,
  onRun,
}: {
  kind: string
  pending: boolean
  onRun: (mode: "stale" | "force") => void
}) {
  if (kind !== RENDITIONS_SWEEP_KIND) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => onRun("stale")}
      >
        <PlayIcon />
        {t("Run now")}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" disabled={pending}>
            <PlayIcon />
            {t("Run now")}
            <ChevronDownIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onRun("stale")}>
          {t("Stale only")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRun("force")}>
          {t("Re-encode all")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CountPill({
  label,
  value,
  tone = "muted",
}: {
  label: string
  value: number
  tone?: "muted" | "active" | "danger"
}) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "active" && "text-primary",
          tone === "muted" && "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-foreground-muted text-2xs tracking-[0.04em] uppercase">
        {label}
      </span>
    </div>
  )
}

function FailedJobs() {
  const queryClient = useQueryClient()
  const failedQuery = useInfiniteQuery(adminFailedJobsQueryOptions(null))
  const jobs = failedQuery.data?.pages.flatMap((page) => page.items) ?? []

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.jobsFailed(null) })
    void queryClient.invalidateQueries({ queryKey: adminKeys.jobsSummary() })
  }

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => api.admin.retryJob(jobId),
    onSuccess: () => toast.success(t("Job queued for retry")),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't retry job"))),
    onSettled: invalidate,
  })
  const discardMutation = useMutation({
    mutationFn: (jobId: string) => api.admin.discardJob(jobId),
    onSuccess: () => toast.success(t("Job discarded")),
    onError: (cause) =>
      toast.error(errorMessage(cause, t("Couldn't discard job"))),
    onSettled: invalidate,
  })
  const busyId =
    (retryMutation.isPending ? retryMutation.variables : null) ??
    (discardMutation.isPending ? discardMutation.variables : null) ??
    null

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{t("Failed jobs")}</span>
      {!failedQuery.data ? (
        <div className="text-foreground-muted grid place-items-center py-4">
          <Spinner className="size-4" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-foreground-muted text-sm">{t("No failed jobs.")}</p>
      ) : (
        <>
          <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            {jobs.map((job) => (
              <FailedJobRow
                key={job.id}
                job={job}
                busy={busyId === job.id}
                onRetry={() => retryMutation.mutate(job.id)}
                onDiscard={() => discardMutation.mutate(job.id)}
              />
            ))}
          </div>
          {failedQuery.hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-center"
              disabled={failedQuery.isFetchingNextPage}
              onClick={() => failedQuery.fetchNextPage()}
            >
              {failedQuery.isFetchingNextPage ? t("Loading…") : t("Load more")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}

function FailedJobRow({
  job,
  busy,
  onRetry,
  onDiscard,
}: {
  job: AdminFailedJob
  busy: boolean
  onRetry: () => void
  onDiscard: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {kindLabel(job.kind)}
          </span>
          {job.attempt > 1 ? (
            <Badge variant="outline" className="shrink-0 text-xs">
              {t("Attempt {n}", { n: job.attempt })}
            </Badge>
          ) : null}
          {job.finishedAt ? (
            <span className="text-foreground-muted text-2xs shrink-0">
              {formatRelativeTime(job.finishedAt)}
            </span>
          ) : null}
        </div>
        {job.error ? (
          <p
            className="text-foreground-dim mt-0.5 truncate font-mono text-xs"
            title={job.error}
          >
            {job.error}
          </p>
        ) : null}
        {job.clipId ? (
          <Link
            to="/clips/$clipId"
            params={{ clipId: job.clipId }}
            className="text-foreground-muted hover:text-foreground mt-0.5 inline-flex items-center gap-1 text-xs"
          >
            <ExternalLinkIcon className="size-3" />
            {t("View clip")}
          </Link>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Retry job")}
          disabled={busy}
          onClick={onRetry}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Discard job")}
          disabled={busy}
          onClick={onDiscard}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
