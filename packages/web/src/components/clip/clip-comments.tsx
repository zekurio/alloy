import { COMMENT_BODY_MAX_LENGTH, type CommentRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { AlertCircleIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ComponentProps, MutableRefObject } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { useSession } from "@/lib/auth-client"
import { currentUrlWithQueryParam } from "@/lib/browser-url"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  useCommentsQuery,
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useToggleCommentLikeMutation,
  useTogglePinCommentMutation,
} from "@/lib/comment-queries"
import { formatRelativeTime } from "@/lib/date-format"
import { errorMessage } from "@/lib/error-message"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"
import {
  displayName,
  userAvatar,
  userHandle,
  useUserChipData,
} from "@/lib/user-display"

import {
  CommentActions,
  CommentAuthHint,
  CommentBody,
  CommentComposer,
  CommentMenu,
  CommentsHeader,
  CommentsSortDropdown,
} from "./clip-comments-parts"

const LONG_COMMENT_CHARS = 260
// Beyond this depth replies stop indenting and continue inline, so deep
// threads don't run out of horizontal room.
const MAX_VISIBLE_REPLY_INDENT = 4

interface ClipCommentsProps extends ComponentProps<"aside"> {
  clipId: string
  clipAuthorId: string
  focusedCommentId?: string | null
}

type Sort = "top" | "new"
type ReplyTarget = { id: string; authorName: string }

function countCommentTree(comment: CommentRow): number {
  return (
    1 +
    comment.replies.reduce((total, reply) => total + countCommentTree(reply), 0)
  )
}

function findCommentPath(
  comments: CommentRow[],
  commentId: string,
): string[] | null {
  for (const comment of comments) {
    if (comment.id === commentId) return [comment.id]
    const replyPath = findCommentPath(comment.replies, commentId)
    if (replyPath) return [comment.id, ...replyPath]
  }
  return null
}

function ClipComments({
  className,
  clipId,
  clipAuthorId,
  focusedCommentId = null,
  ...props
}: ClipCommentsProps) {
  const [draft, setDraft] = useState("")
  const [sort, setSort] = useState<Sort>("top")
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null)
  const [openReplyIds, setOpenReplyIds] = useState<Set<string>>(() => new Set())
  const [flashingCommentId, setFlashingCommentId] = useState<string | null>(
    null,
  )
  const commentRefs = useRef(new Map<string, HTMLLIElement>())
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const loadingFocusedCommentRef = useRef(false)
  const flashedCommentRef = useRef<string | null>(null)
  const { data: session } = useSession()
  const me = useUserChipData(session?.user)
  const viewerId = session?.user?.id ?? null
  const meAvatarStyle = {
    background: me.avatar.bg,
    color: me.avatar.fg,
  } as const
  const isRepliesOpen = useCallback(
    (commentId: string) => openReplyIds.has(commentId),
    [openReplyIds],
  )

  useEffect(() => {
    setDraft("")
    setReplyTarget(null)
    setSort("top")
    setOpenReplyIds(new Set())
    setFlashingCommentId(null)
    loadingFocusedCommentRef.current = false
    flashedCommentRef.current = null
  }, [clipId])

  useEffect(() => {
    flashedCommentRef.current = null
    setFlashingCommentId(null)
    loadingFocusedCommentRef.current = false
  }, [focusedCommentId])

  const commentsQuery = useCommentsQuery(clipId, sort)
  const comments = useMemo(
    () => commentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [commentsQuery.data],
  )
  const create = useCreateCommentMutation(clipId)
  const authConfig = useSuspenseAuthConfig()

  const totalCount = useMemo(
    () => comments.reduce((n, c) => n + countCommentTree(c), 0),
    [comments],
  )

  const isSignedIn = viewerId !== null
  const canSignUp =
    authConfig.openRegistrations &&
    (authConfig.passkeyEnabled || authConfig.providers.length > 0)
  const bodyLength = draft.trim().length
  const canSubmit =
    bodyLength > 0 && bodyLength <= COMMENT_BODY_MAX_LENGTH && isSignedIn

  function toggleReplies(commentId: string) {
    setOpenReplyIds((current) => {
      const next = new Set(current)
      if (next.has(commentId)) {
        next.delete(commentId)
      } else {
        next.add(commentId)
      }
      return next
    })
  }

  function startReply(target: ReplyTarget) {
    setReplyTarget(target)
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }

  function cancelReply() {
    setReplyTarget(null)
  }

  async function copyCommentLink(commentId: string) {
    const url = currentUrlWithQueryParam("comment", commentId)

    const copied =
      url !== null &&
      (await copyTextToClipboard(url, {
        action: "copy comment link",
      }))
    if (copied) {
      toast.success(t("Comment link copied"))
    } else {
      toast.error(t("Couldn't copy comment link"))
    }
  }

  async function submitComment() {
    const body = draft.trim()
    if (!body || !isSignedIn) return
    try {
      await create.mutateAsync({
        body,
        parentId: replyTarget?.id,
      })
      if (replyTarget) {
        const parentId = replyTarget.id
        setOpenReplyIds((current) => new Set(current).add(parentId))
        setReplyTarget(null)
      }
      setDraft("")
    } catch (err) {
      toast.error(
        errorMessage(
          err,
          replyTarget ? t("Couldn't post reply") : t("Couldn't post comment"),
        ),
      )
    }
  }

  useEffect(() => {
    if (!focusedCommentId) return
    const path = findCommentPath(comments, focusedCommentId)

    if (!path) {
      if (
        commentsQuery.hasNextPage &&
        !commentsQuery.isFetchingNextPage &&
        !loadingFocusedCommentRef.current
      ) {
        loadingFocusedCommentRef.current = true
        void commentsQuery.fetchNextPage().finally(() => {
          loadingFocusedCommentRef.current = false
        })
      }
      return
    }

    const ancestorIds = path.slice(0, -1)
    if (ancestorIds.length > 0) {
      setOpenReplyIds((current) => {
        let changed = false
        const next = new Set(current)
        for (const id of ancestorIds) {
          if (!next.has(id)) {
            next.add(id)
            changed = true
          }
        }
        return changed ? next : current
      })
    }

    if (flashedCommentRef.current === focusedCommentId) return

    const scrollAndFlash = () => {
      const target = commentRefs.current.get(focusedCommentId)
      if (!target) return
      flashedCommentRef.current = focusedCommentId
      target.scrollIntoView({ block: "center", behavior: "smooth" })
      setFlashingCommentId(focusedCommentId)
      window.setTimeout(() => {
        setFlashingCommentId((current) =>
          current === focusedCommentId ? null : current,
        )
      }, 2400)
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollAndFlash)
    })
  }, [
    comments,
    commentsQuery,
    commentsQuery.hasNextPage,
    commentsQuery.isFetchingNextPage,
    focusedCommentId,
  ])

  return (
    <aside
      data-slot="clip-comments"
      className={cn(
        "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] border-l border-border bg-surface",
        className,
      )}
      {...props}
    >
      <div data-slot="clip-comments-scroll" className="min-h-0 overflow-y-auto">
        {comments.length > 0 ? <CommentsHeader count={totalCount} /> : null}
        {commentsQuery.isLoading ? (
          <div className="flex h-full items-center justify-center p-6">
            <Spinner />
          </div>
        ) : commentsQuery.error && comments.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={AlertCircleIcon}
              size="lg"
              title={t("Couldn't load comments")}
              hint={t("Try again in a moment.")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={commentsQuery.isFetching}
                  onClick={() => void commentsQuery.refetch()}
                >
                  {commentsQuery.isFetching ? (
                    <Spinner className="size-4" />
                  ) : null}
                  {t("Retry")}
                </Button>
              }
            />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              kaomoji
              seed={`comments-${clipId}`}
              size="lg"
              title={t("No comments yet")}
              hint={t("Be the first to leave your thoughts!")}
            />
          </div>
        ) : (
          <>
            <ul className="flex flex-col">
              {comments.map((comment) => (
                <CommentRowView
                  key={comment.id}
                  comment={comment}
                  clipId={clipId}
                  clipAuthorId={clipAuthorId}
                  viewerId={viewerId}
                  depth={0}
                  repliesOpen={isRepliesOpen(comment.id)}
                  isRepliesOpen={isRepliesOpen}
                  flashingCommentId={flashingCommentId}
                  commentRefs={commentRefs}
                  onToggleReplies={toggleReplies}
                  onStartReply={startReply}
                  onCopyLink={copyCommentLink}
                />
              ))}
            </ul>
            {commentsQuery.hasNextPage ? (
              <div className="flex justify-center p-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={commentsQuery.isFetchingNextPage}
                  onClick={() => void commentsQuery.fetchNextPage()}
                >
                  {commentsQuery.isFetchingNextPage ? (
                    <Spinner className="size-4" />
                  ) : null}
                  {t("Load more")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="bg-surface relative flex flex-col justify-end p-3">
        <div className="mb-1.5">
          <CommentsSortDropdown sort={sort} onSortChange={setSort} />
        </div>
        {isSignedIn ? (
          <CommentComposer
            draft={draft}
            me={me}
            meAvatarStyle={meAvatarStyle}
            inputRef={composerRef}
            replyingToName={replyTarget?.authorName}
            placeholder={
              replyTarget
                ? t("Reply to {authorName}…", {
                    authorName: replyTarget.authorName,
                  })
                : t("Add a comment…")
            }
            submitting={create.isPending}
            canSubmit={canSubmit}
            onDraftChange={setDraft}
            onClear={() => setDraft("")}
            onCancelReply={cancelReply}
            onSubmit={submitComment}
          />
        ) : (
          <CommentAuthHint canSignUp={canSignUp} />
        )}
      </div>
    </aside>
  )
}

function CommentRowView({
  comment,
  clipId,
  clipAuthorId,
  viewerId,
  depth,
  repliesOpen,
  isRepliesOpen,
  flashingCommentId,
  commentRefs,
  onToggleReplies,
  onStartReply,
  onCopyLink,
}: {
  comment: CommentRow
  clipId: string
  clipAuthorId: string
  viewerId: string | null
  depth: number
  repliesOpen: boolean
  isRepliesOpen: (commentId: string) => boolean
  flashingCommentId: string | null
  commentRefs: MutableRefObject<Map<string, HTMLLIElement>>
  onToggleReplies: (commentId: string) => void
  onStartReply: (target: ReplyTarget) => void
  onCopyLink: (commentId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isDeleted = comment.body.length === 0
  const isLong = !isDeleted && comment.body.length > LONG_COMMENT_CHARS

  const toggleLike = useToggleCommentLikeMutation(clipId)
  const togglePin = useTogglePinCommentMutation(clipId)
  const del = useDeleteCommentMutation(clipId)

  const isViewerClipAuthor = viewerId !== null && viewerId === clipAuthorId
  const isCommentAuthor = viewerId !== null && viewerId === comment.author.id
  const canReply = viewerId !== null && !isDeleted
  const canPin = isViewerClipAuthor && depth === 0 && !isDeleted
  const canDelete = !isDeleted && (isCommentAuthor || isViewerClipAuthor)
  const isTopLevel = depth === 0

  function onToggleLike() {
    if (!viewerId) {
      toast.error(t("Sign in to like comments"))
      return
    }
    toggleLike.mutate(
      {
        commentId: comment.id,
        nextLiked: !comment.likedByViewer,
      },
      {
        onError: (err) => {
          toast.error(errorMessage(err, t("Couldn't update like")))
        },
      },
    )
  }

  function onPinToggle() {
    togglePin.mutate(
      { commentId: comment.id, nextPinned: !comment.pinned },
      {
        onError: (err) => {
          toast.error(errorMessage(err, t("Couldn't pin")))
        },
      },
    )
  }

  function onDelete() {
    del.mutate(
      { commentId: comment.id },
      {
        onError: (err) => {
          toast.error(errorMessage(err, t("Couldn't delete")))
        },
      },
    )
  }

  const authorName = displayName(comment.author)
  const avatar = userAvatar(comment.author)
  const avatarStyle = { background: avatar.bg, color: avatar.fg }

  return (
    <li
      ref={(node) => {
        if (node) commentRefs.current.set(comment.id, node)
        else commentRefs.current.delete(comment.id)
      }}
      data-comment-id={comment.id}
      className={cn(
        "flex min-w-0 scroll-mt-6 rounded-md transition-[background-color,box-shadow] duration-700",
        isTopLevel ? "gap-2.5 px-4 py-3" : "gap-2.5 py-2.5",
        flashingCommentId === comment.id &&
          "bg-accent-soft shadow-[inset_3px_0_0_var(--accent),0_0_0_1px_var(--accent-border)]",
      )}
    >
      <Avatar
        size={isTopLevel ? "md" : "sm"}
        className="mt-1 shrink-0"
        style={avatarStyle}
      >
        {avatar.src ? <AvatarImage src={avatar.src} alt={authorName} /> : null}
        <AvatarFallback style={avatarStyle}>{avatar.initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2 leading-4">
          <span className="text-foreground text-[0.9375rem] font-semibold">
            {authorName}
          </span>
          <span className="text-foreground-faint text-xs">
            {userHandle(comment.author)}
          </span>
          {comment.author.id === clipAuthorId ? (
            <span className="bg-accent-soft text-accent inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.6875rem] leading-3 font-semibold tracking-wide uppercase">
              {t("Author")}
            </span>
          ) : null}
          <span className="text-foreground-faint text-xs">
            {formatRelativeTime(comment.createdAt)}
          </span>
          <CommentMenu
            canDelete={canDelete}
            deletePending={del.isPending}
            deleteTitle={
              isTopLevel ? t("Delete this comment?") : t("Delete this reply?")
            }
            deleteDescription={t(
              "This will remove the comment text. Replies will stay visible.",
            )}
            deleteActionLabel={
              isTopLevel ? t("Delete comment") : t("Delete reply")
            }
            onCopyLink={() => onCopyLink(comment.id)}
            onDelete={onDelete}
          />
        </div>

        <CommentBody
          body={isDeleted ? t("Deleted comment") : comment.body}
          mentions={comment.mentions}
          expanded={expanded}
          isLong={isLong}
          edited={!isDeleted && comment.editedAt !== null}
          deleted={isDeleted}
          onToggle={() => setExpanded((value) => !value)}
        />
        <CommentActions
          liked={comment.likedByViewer}
          likeCount={comment.likeCount}
          likedByAuthor={
            comment.likedByAuthor && comment.author.id !== clipAuthorId
          }
          replyCount={comment.replies.length}
          repliesOpen={repliesOpen}
          canReply={canReply}
          showLike={!isDeleted}
          compactReplies={depth > 0}
          pinned={comment.pinned}
          canPin={canPin}
          onPinToggle={onPinToggle}
          onToggleLike={onToggleLike}
          onToggleReplies={() => onToggleReplies(comment.id)}
          onStartReply={() =>
            onStartReply({ id: comment.id, authorName: authorName })
          }
        />

        {repliesOpen && comment.replies.length > 0
          ? (() => {
              const replyItems = comment.replies.map((reply) => (
                <CommentRowView
                  key={reply.id}
                  comment={reply}
                  clipId={clipId}
                  clipAuthorId={clipAuthorId}
                  viewerId={viewerId}
                  depth={depth + 1}
                  repliesOpen={isRepliesOpen(reply.id)}
                  isRepliesOpen={isRepliesOpen}
                  flashingCommentId={flashingCommentId}
                  commentRefs={commentRefs}
                  onToggleReplies={onToggleReplies}
                  onStartReply={onStartReply}
                  onCopyLink={onCopyLink}
                />
              ))

              // Past the indent cap the thread runs out of horizontal room, so
              // continue inline without another rail.
              if (depth >= MAX_VISIBLE_REPLY_INDENT) {
                return <ul className="mt-1.5 flex flex-col">{replyItems}</ul>
              }

              return (
                <div className="relative mt-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleReplies(comment.id)}
                    aria-label={t("Collapse thread")}
                    className="group/thread absolute inset-y-0 left-0 z-10 flex w-4 cursor-pointer justify-center focus-visible:outline-none"
                  >
                    <span className="bg-border group-hover/thread:bg-foreground-faint group-focus-visible/thread:bg-foreground-faint h-full w-px rounded-full transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]" />
                  </button>
                  <ul className="flex flex-col pl-4">{replyItems}</ul>
                </div>
              )
            })()
          : null}
      </div>
    </li>
  )
}

export { ClipComments }
