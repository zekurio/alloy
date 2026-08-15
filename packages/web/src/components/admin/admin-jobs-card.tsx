import type {
  AdminFailedJob,
  AdminJobOperations,
  AdminJobQueueRow,
  AdminRenditionSweepSummary,
  AdminStorageGcSummary,
  AdminSweepKind,
} from "@alloy/api"
import { isJobKind, type JobKind, type JobQueue } from "@alloy/contracts"
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
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { List, ListItem } from "@alloy/ui/components/list"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@alloy/ui/components/section"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ExternalLinkIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import {
  adminFailedJobsQueryOptions,
  adminJobsSummaryQueryOptions,
  adminKeys,
  hasActiveJobs,
} from "@/lib/admin-query-keys"
import { api } from "@/lib/api"
import { formatDateTime, formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"

// Exhaustive over the contracts JOB_KINDS list: adding a job kind without a
// dashboard label fails typecheck here.
const JOB_KIND_LABELS: Record<JobKind, string> = {
  "auth.challenge-prune": t("Prune auth challenges"),
  "clip.encode": t("Encode clip"),
  "clip.renditions-sweep": t("Rendition sweep"),
  "job.prune": t("Prune job history"),
  "storage.orphan-gc": t("Storage cleanup"),
  "notification.prune": t("Prune notifications"),
  "upload.cleanup": t("Clean up uploads"),
  "webhook.deliver": t("Deliver webhook"),
}

const QUEUE_LABELS: Record<JobQueue, string> = {
  encode: t("Media encoding"),
  io: t("Storage and delivery"),
  maintenance: t("Routine maintenance"),
}

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
      <QueueHealth queues={summaryQuery.data.queues} />
      <Operations operations={summaryQuery.data.operations} />
      <FailedJobs
        jobsActive={hasActiveJobs(summaryQuery.data)}
        failedTotal={summaryQuery.data.queues.reduce(
          (sum, queue) => sum + queue.failed,
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

function QueueHealth({ queues }: { queues: AdminJobQueueRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">{t("Queue health")}</h3>
        <p className="text-foreground-dim text-xs">
          {t("Current work and recent results for each worker queue.")}
        </p>
      </div>
      <List>
        {queues.map((row) => (
          <ListItem key={row.queue}>
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
                  {QUEUE_LABELS[row.queue]}
                </h4>
              </div>
              <JobCounts counts={row} />
            </div>
          </ListItem>
        ))}
      </List>
    </div>
  )
}

function JobCounts({
  counts,
}: {
  counts: Pick<AdminJobQueueRow, "pending" | "running" | "failed" | "completed">
}) {
  return (
    <div className="text-foreground-dim mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <CountCell label={t("Pending")} value={counts.pending} />
      <CountCell label={t("Running")} value={counts.running} tone="active" />
      <CountCell label={t("Failed")} value={counts.failed} tone="danger" />
      <CountCell label={t("Completed")} value={counts.completed} />
    </div>
  )
}

function Operations({ operations }: { operations: AdminJobOperations }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">{t("Operations")}</h3>
        <p className="text-foreground-dim text-xs">
          {t("Start maintenance work and review its last completed run.")}
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <RenditionOperation operation={operations.renditionSweep} />
        <StorageGcOperation operation={operations.storageGc} />
      </div>
    </div>
  )
}

function RenditionOperation({
  operation,
}: {
  operation: AdminJobOperations["renditionSweep"]
}) {
  const queryClient = useQueryClient()
  const staleFeedback = useActionFeedback()
  const forceFeedback = useActionFeedback()
  const mutation = useMutation({
    mutationFn: (mode: "stale" | "force") =>
      api.admin.runJobSweep(
        "clip.renditions-sweep" satisfies AdminSweepKind,
        mode,
      ),
    onSettled: () => invalidateJobQueries(queryClient),
  })
  const active = operation.pending > 0 || operation.running > 0
  const actionError =
    staleFeedback.feedback.state === "error"
      ? staleFeedback.feedback.message
      : forceFeedback.feedback.state === "error"
        ? forceFeedback.feedback.message
        : null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardTitle>{t("Apply transcoding changes")}</CardTitle>
          <CardDescription>
            {t(
              "Queue clips whose current renditions do not match the transcoding settings.",
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <JobCounts counts={operation} />
        <RenditionSummary summary={operation.summary} />
        <div className="flex flex-wrap gap-2">
          <FeedbackButton
            type="button"
            variant="outline"
            size="sm"
            disabled={active || mutation.isPending}
            state={staleFeedback.feedback.state}
            pendingLabel={t("Starting...")}
            successLabel={t("Started")}
            errorLabel={t("Try again")}
            onClick={() => {
              forceFeedback.reset()
              void staleFeedback.run(
                () => mutation.mutateAsync("stale"),
                t("Couldn't start job"),
              )
            }}
          >
            <PlayIcon />
            {t("Apply transcoding changes")}
          </FeedbackButton>
          <FeedbackButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={active || mutation.isPending}
            state={forceFeedback.feedback.state}
            pendingLabel={t("Starting...")}
            successLabel={t("Started")}
            errorLabel={t("Try again")}
            onClick={() => {
              staleFeedback.reset()
              void forceFeedback.run(
                () => mutation.mutateAsync("force"),
                t("Couldn't start job"),
              )
            }}
          >
            <RotateCcwIcon />
            {t("Re-encode all")}
          </FeedbackButton>
        </div>
        {actionError ? (
          <p role="alert" className="text-destructive text-xs">
            {actionError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function StorageGcOperation({
  operation,
}: {
  operation: AdminJobOperations["storageGc"]
}) {
  const queryClient = useQueryClient()
  const [confirmPreview, setConfirmPreview] =
    useState<AdminStorageGcSummary | null>(null)
  const previewMutation = useMutation({
    mutationFn: () => api.admin.previewStorageCleanup(),
    onSettled: () => invalidateJobQueries(queryClient),
  })
  const previewFeedback = useActionFeedback()
  const confirmMutation = useMutation({
    mutationFn: (previewJobId: string) =>
      api.admin.confirmStorageCleanup(previewJobId),
    onSuccess: () => setConfirmPreview(null),
    onSettled: () => invalidateJobQueries(queryClient),
  })
  const active = operation.pending > 0 || operation.running > 0
  const preview =
    operation.summary?.mode === "preview" ? operation.summary : null
  const previewCandidateCount = confirmPreview
    ? confirmPreview.orphanCandidates + confirmPreview.staleAssetCandidates
    : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <CardTitle>{t("Clean orphaned storage")}</CardTitle>
          <CardDescription>
            {t(
              "Preview old clip objects that are no longer referenced, then confirm their deletion.",
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <JobCounts counts={operation} />
        <StorageGcSummary summary={operation.summary} />
        <FeedbackButton
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={active || previewMutation.isPending}
          state={previewFeedback.feedback.state}
          pendingLabel={t("Starting...")}
          successLabel={t("Started")}
          errorLabel={t("Try again")}
          onClick={() =>
            void previewFeedback.run(async () => {
              await previewMutation.mutateAsync()
            }, t("Couldn't start job"))
          }
        >
          <SearchIcon />
          {t("Preview cleanup")}
        </FeedbackButton>
        {preview ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="self-start"
            disabled={active || confirmMutation.isPending}
            onClick={() => setConfirmPreview(preview)}
          >
            <Trash2Icon />
            {t("Delete previewed objects")}
          </Button>
        ) : null}
        <ConfirmDeleteDialog
          open={confirmPreview !== null}
          onOpenChange={(open) => {
            if (open) return
            setConfirmPreview(null)
            confirmMutation.reset()
          }}
          title={t("Delete previewed objects?")}
          description={t(
            "This permanently deletes only the objects in the selected preview. Alloy checks each object again before deletion. This action cannot be undone.",
          )}
          confirmLabel={t("Delete objects")}
          pendingLabel={t("Starting...")}
          pending={confirmMutation.isPending}
          error={
            confirmMutation.error
              ? errorMessage(confirmMutation.error, t("Couldn't start job"))
              : undefined
          }
          onConfirm={() => {
            if (confirmPreview) {
              confirmMutation.mutate(confirmPreview.previewJobId)
            }
          }}
        >
          {confirmPreview ? (
            <p className="text-foreground-muted text-sm">
              {t(
                previewCandidateCount === 1
                  ? "Preview from {time}: {count} object is a candidate for deletion."
                  : "Preview from {time}: {count} objects are candidates for deletion.",
                {
                  time: formatDateTime(confirmPreview.finishedAt),
                  count: previewCandidateCount,
                },
              )}
            </p>
          ) : null}
        </ConfirmDeleteDialog>
      </CardContent>
    </Card>
  )
}

function RenditionSummary({
  summary,
}: {
  summary: AdminRenditionSweepSummary | null
}) {
  if (!summary) return <EmptyOperationSummary />
  return (
    <OperationSummary finishedAt={summary.finishedAt}>
      <SummaryValue
        label={t("Mode")}
        value={
          summary.mode === "force" ? t("Re-encode all") : t("Apply changes")
        }
      />
      <SummaryValue label={t("Scanned")} value={summary.scanned} />
      <SummaryValue label={t("Queued")} value={summary.enqueued} />
      <SummaryValue label={t("Up to date")} value={summary.upToDate} />
      <SummaryValue label={t("Unprobed or invalid")} value={summary.unprobed} />
      <SummaryValue label={t("Quarantined")} value={summary.quarantined} />
    </OperationSummary>
  )
}

function StorageGcSummary({
  summary,
}: {
  summary: AdminStorageGcSummary | null
}) {
  if (!summary) return <EmptyOperationSummary />
  return (
    <OperationSummary finishedAt={summary.finishedAt}>
      <SummaryValue
        label={t("Mode")}
        value={summary.mode === "preview" ? t("Preview") : t("Delete")}
      />
      <SummaryValue label={t("Scanned")} value={summary.scanned} />
      <SummaryValue
        label={t("Orphan candidates")}
        value={summary.orphanCandidates}
      />
      <SummaryValue
        label={t("Stale asset candidates")}
        value={summary.staleAssetCandidates}
      />
      <SummaryValue
        label={t("Deleted orphan objects")}
        value={summary.deletedOrphanObjects}
      />
      <SummaryValue
        label={t("Deleted stale assets")}
        value={summary.deletedStaleAssets}
      />
      <SummaryValue
        label={t("Delete failures")}
        value={summary.deleteFailures}
      />
    </OperationSummary>
  )
}

function EmptyOperationSummary() {
  return (
    <div className="border-border-subtle text-foreground-dim rounded-md border p-3 text-xs">
      {t("No completed run yet")}
    </div>
  )
}

function OperationSummary({
  finishedAt,
  children,
}: {
  finishedAt: string
  children: ReactNode
}) {
  return (
    <div className="border-border-subtle rounded-md border p-3">
      <p className="text-foreground-dim mb-2 text-xs">
        {t("Last completed {time}", { time: formatDateTime(finishedAt) })}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {children}
      </dl>
    </div>
  )
}

function SummaryValue({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="min-w-0">
      <dt className="text-foreground-muted truncate text-xs">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function invalidateJobQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: adminKeys.jobsSummary() })
  void queryClient.invalidateQueries({ queryKey: adminKeys.jobsFailed(null) })
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
    onSettled: invalidate,
  })
  const discardMutation = useMutation({
    mutationFn: (jobId: string) => api.admin.discardJob(jobId),
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
              retryError={
                retryMutation.variables === job.id && retryMutation.error
                  ? errorMessage(retryMutation.error, t("Couldn't retry job"))
                  : null
              }
              discardError={
                discardMutation.variables === job.id && discardMutation.error
                  ? errorMessage(
                      discardMutation.error,
                      t("Couldn't discard job"),
                    )
                  : null
              }
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
  retryError,
  discardError,
  onRetry,
  onDiscard,
}: {
  job: AdminFailedJob
  busy: boolean
  retryError: string | null
  discardError: string | null
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
          <Badge size="text" className="bg-background shrink-0">
            {t("Attempt {n}", { n: job.attempt })}
          </Badge>
          {job.finishedAt ? (
            <span
              className="text-foreground-muted text-2xs shrink-0"
              title={formatDateTime(job.finishedAt)}
            >
              {formatRelativeTime(job.finishedAt)}
            </span>
          ) : null}
        </div>
        {job.error ? (
          <p className="text-foreground-dim mt-1 font-mono text-xs break-all whitespace-pre-wrap">
            {job.error}
          </p>
        ) : null}
        {!job.retryable && job.kind === "storage.orphan-gc" ? (
          <p className="text-foreground-muted mt-1 text-xs">
            {t("Run a new storage cleanup preview to recover this operation.")}
          </p>
        ) : null}
        {retryError || discardError ? (
          <p role="alert" className="text-destructive mt-0.5 text-xs">
            {retryError ?? discardError}
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
        {job.retryable ? (
          <FeedbackButton
            variant="ghost"
            size="icon-sm"
            aria-label={t("Retry job")}
            disabled={busy}
            state={retryError ? "error" : "idle"}
            errorLabel={<span className="sr-only">{t("Try again")}</span>}
            onClick={onRetry}
          >
            <RotateCcwIcon className="size-3.5" />
          </FeedbackButton>
        ) : null}
        <FeedbackButton
          variant="ghost"
          size="icon-sm"
          aria-label={t("Discard job")}
          disabled={busy}
          state={discardError ? "error" : "idle"}
          errorLabel={<span className="sr-only">{t("Try again")}</span>}
          onClick={onDiscard}
        >
          <XIcon className="size-3.5" />
        </FeedbackButton>
      </div>
    </ListItem>
  )
}
