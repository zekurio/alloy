import type {
  AdminFailedJob,
  AdminJobKindRow,
  AdminSweepKind,
} from "@alloy/api"
import { ADMIN_SWEEP_KINDS, isJobKind, type JobKind } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Badge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alloy/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { List, ListItem } from "@alloy/ui/components/list"
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
  SearchIcon,
  XIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { ListEmpty } from "@/components/feedback/empty-state"
import {
  adminFailedJobsQueryOptions,
  adminJobsSummaryQueryOptions,
  adminKeys,
  hasActiveJobs,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { dateTime, formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"

const RENDITIONS_SWEEP_KIND = "clip.renditions-sweep"

// Exhaustive over the contracts JOB_KINDS list: adding a job kind without a
// dashboard label fails typecheck here.
const JOB_KIND_LABELS: Record<JobKind, string> = {
  "clip.encode": t("Encode clip"),
  "clip.renditions-sweep": t("Rendition sweep"),
  "clip.verify-assets": t("Verify assets"),
  "clip.verify": t("Verify clip"),
  "storage.orphan-gc": t("Storage cleanup"),
  "maintenance.run": t("Maintenance"),
  "notification.prune": t("Prune notifications"),
  "webhook.retract": t("Retract webhook announce"),
  "webhook.sync": t("Publish webhooks"),
}

const SWEEP_KINDS: ReadonlySet<string> = new Set<AdminSweepKind>(
  ADMIN_SWEEP_KINDS,
)

function kindLabel(kind: string): string {
  return isJobKind(kind) ? JOB_KIND_LABELS[kind] : kind
}

export function AdminJobsCard({ hideHeader }: { hideHeader?: boolean }) {
  const summaryQuery = useQuery(adminJobsSummaryQueryOptions())
  const loadError = summaryQuery.error
    ? errorMessage(summaryQuery.error, t("Failed to load jobs"))
    : null

  const content = loadError ? (
    <Callout tone="destructive">{loadError}</Callout>
  ) : !summaryQuery.data ? (
    <div className="text-foreground-muted grid place-items-center py-6">
      <Spinner className="size-4" />
    </div>
  ) : (
    <div className="flex flex-col gap-5">
      <KindTable kinds={summaryQuery.data.kinds} />
      <FailedJobs
        jobsActive={hasActiveJobs(summaryQuery.data)}
        failedTotal={summaryQuery.data.kinds.reduce(
          (sum, k) => sum + k.failed,
          0,
        )}
      />
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

function KindTable({ kinds }: { kinds: AdminJobKindRow[] }) {
  const [search, setSearch] = useState("")
  const filteredKinds = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    if (!normalizedSearch) return kinds
    return kinds.filter((row) =>
      kindLabel(row.kind).toLocaleLowerCase().includes(normalizedSearch),
    )
  }, [kinds, search])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{t("Job types")}</h3>
          <p className="text-foreground-dim text-xs">
            {t(
              "Compact queue controls. Counts update while this panel is open.",
            )}
          </p>
        </div>
        <InputGroup className="w-full sm:max-w-xs">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Search jobs")}
            aria-label={t("Search jobs")}
          />
        </InputGroup>
      </div>
      {filteredKinds.length === 0 ? (
        <ListEmpty title={t("No matching jobs")} />
      ) : (
        <List>
          {filteredKinds.map((row) => (
            <KindRow key={row.kind} row={row} />
          ))}
        </List>
      )}
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

  const scheduleHint = jobScheduleHint(row)

  return (
    <ListItem>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              row.failed > 0
                ? "bg-destructive"
                : row.running > 0
                  ? "bg-primary"
                  : "bg-border-emphasis",
            )}
          />
          <h4 className="truncate text-sm font-semibold">
            {kindLabel(row.kind)}
          </h4>
          {row.paused ? (
            <Badge size="text" variant="secondary" className="shrink-0">
              {t("Paused")}
            </Badge>
          ) : null}
        </div>
        <div className="text-foreground-dim mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span>{scheduleHint}</span>
          {row.pending > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <CountCell label={t("Pending")} value={row.pending} />
            </>
          ) : null}
          {row.running > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <CountCell
                label={t("Running")}
                value={row.running}
                tone="active"
              />
            </>
          ) : null}
          {row.failed > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <CountCell label={t("Failed")} value={row.failed} tone="danger" />
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2">
        {SWEEP_KINDS.has(row.kind) ? (
          <RunNowAction
            kind={row.kind}
            pending={sweepMutation.isPending}
            onRun={(mode) => sweepMutation.mutate(mode)}
          />
        ) : null}
        <Switch
          size="sm"
          checked={!row.paused}
          disabled={pauseMutation.isPending}
          aria-label={row.paused ? t("Paused") : t("Enabled")}
          onCheckedChange={(next) => pauseMutation.mutate(!next)}
        />
      </div>
    </ListItem>
  )
}

function jobScheduleHint(row: AdminJobKindRow): string {
  if (row.schedule) {
    if (!row.schedule.nextRunAt) return t("Scheduled")
    const nextRunAt = dateTime(row.schedule.nextRunAt)
    if (nextRunAt !== null && nextRunAt <= Date.now()) return t("Due now")
    return t("Next run {when}", {
      when: formatRelativeTime(row.schedule.nextRunAt),
    })
  }
  if (row.kind === RENDITIONS_SWEEP_KIND) {
    return t("Event triggered or manual")
  }
  if (SWEEP_KINDS.has(row.kind)) return t("Manual")
  return t("Event triggered")
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
        {pending ? t("Starting...") : t("Run")}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" disabled={pending}>
            <PlayIcon />
            {pending ? t("Starting...") : t("Run")}
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

function CountCell({
  label,
  value,
  tone = "muted",
}: {
  label: string
  value: number
  tone?: "muted" | "active" | "danger"
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="truncate text-xs">{label}</span>
      <span
        className={cn(
          "text-xs font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "active" && "text-primary",
          tone === "muted" && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function FailedJobs({
  jobsActive,
  failedTotal,
}: {
  jobsActive: boolean
  failedTotal: number
}) {
  const queryClient = useQueryClient()
  const failedQuery = useInfiniteQuery(
    adminFailedJobsQueryOptions(null, jobsActive),
  )
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

  if (!failedQuery.data || jobs.length === 0) return null

  return (
    <Card tone="destructive">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <CardTitle>{t("Failed jobs")}</CardTitle>
            <Badge variant="destructive" size="text">
              {failedTotal}
            </Badge>
          </div>
          <CardDescription>
            {t("Retry or discard failures after checking the error message.")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <List>
          {jobs.map((job) => (
            <FailedJobRow
              key={job.id}
              job={job}
              busy={busyId === job.id}
              onRetry={() => retryMutation.mutate(job.id)}
              onDiscard={() => discardMutation.mutate(job.id)}
            />
          ))}
        </List>
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
      </CardContent>
    </Card>
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
    <ListItem>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {kindLabel(job.kind)}
          </span>
          {job.attempt > 1 ? (
            <Badge size="text" className="bg-background shrink-0">
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
    </ListItem>
  )
}
