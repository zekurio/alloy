import * as React from "react"
import { PinIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/lib/toast"
import { cn } from "@workspace/ui/lib/utils"

import { useSession } from "@/lib/auth-client"
import { formatRelativeTime } from "@/lib/clip-format"
import {
  useCommentsQuery,
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useToggleCommentLikeMutation,
  useTogglePinCommentMutation,
} from "@/lib/comment-queries"
import type { CommentRow } from "@workspace/api"
import {
  avatarTint,
  displayInitials,
  displayName,
  userImageSrc,
  useUserChipData,
} from "@/lib/user-display"
import {
  CommentActions,
  CommentBody,
  CommentComposer,
  CommentMenu,
  CommentsHeader,
  CommentsSortDropdown,
} from "./clip-comments-parts"
import { EmptyState } from "@/components/feedback/empty-state"

const LONG_COMMENT_CHARS = 260
const MAX_VISIBLE_REPLY_INDENT = 2

interface ClipCommentsProps extends React.ComponentProps<"aside"> {
  clipId: string
  clipAuthorId: string
}

type Sort = "top" | "new"
type ReplyTarget = { id: string; authorName: string }

function authorAvatarStyle(comment: CommentRow) {
  const { bg, fg } = avatarTint(comment.author.id || comment.author.name)
  return { background: bg, color: fg }
}

function useAuthorAvatarSrc(author: CommentRow["author"]): string | undefined {
  return userImageSrc(author.image)
}

function countCommentTree(comment: CommentRow): number {
  return (
    1 +
    comment.replies.reduce((total, reply) => total + countCommentTree(reply), 0)
  )
}

function ClipComments({
  className,
  clipId,
  clipAuthorId,
  ...props
}: ClipCommentsProps) {
  const [draft, setDraft] = React.useState("")
  const [sort, setSort] = React.useState<Sort>("top")
  const [replyTarget, setReplyTarget] = React.useState<ReplyTarget | null>(null)
  const [openReplyIds, setOpenReplyIds] = React.useState<Set<string>>(
    () => new Set()
  )
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  const { data: session } = useSession()
  const me = useUserChipData(session?.user)
  const viewerId = session?.user?.id ?? null
  const meAvatarStyle = {
    background: me.avatar.bg,
    color: me.avatar.fg,
  } as const
  const isRepliesOpen = React.useCallback(
    (commentId: string) => openReplyIds.has(commentId),
    [openReplyIds]
  )

  React.useEffect(() => {
    setDraft("")
    setReplyTarget(null)
    setSort("top")
    setOpenReplyIds(new Set())
  }, [clipId])

  const commentsQuery = useCommentsQuery(clipId, sort)
  const comments = React.useMemo(
    () => commentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [commentsQuery.data]
  )
  const create = useCreateCommentMutation(clipId)

  const totalCount = React.useMemo(
    () => comments.reduce((n, c) => n + countCommentTree(c), 0),
    [comments]
  )

  const isSignedIn = viewerId !== null
  const canSubmit = draft.trim().length > 0 && isSignedIn

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
        err instanceof Error
          ? err.message
          : replyTarget
            ? "Couldn't post reply"
            : "Couldn't post comment"
      )
    }
  }

  return (
    <aside
      data-slot="clip-comments"
      className={cn(
        "flex h-full min-h-0 flex-col border-l border-border bg-surface",
        className
      )}
      {...props}
    >
      <div className="flex-1 overflow-y-auto">
        {comments.length > 0 ? <CommentsHeader count={totalCount} /> : null}
        {commentsQuery.isLoading ? (
          <div className="flex h-full items-center justify-center p-6">
            <Spinner />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              seed={`comments-${clipId}`}
              size="lg"
              title="No comments yet"
              hint="Be the first to leave your thoughts!"
            />
          </div>
        ) : (
          <>
            <ul className="flex flex-col">
              {comments.map((comment, index) => (
                <CommentRowView
                  key={comment.id}
                  comment={comment}
                  first={index === 0}
                  clipId={clipId}
                  clipAuthorId={clipAuthorId}
                  viewerId={viewerId}
                  depth={0}
                  repliesOpen={isRepliesOpen(comment.id)}
                  isRepliesOpen={isRepliesOpen}
                  onToggleReplies={toggleReplies}
                  onStartReply={startReply}
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
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t border-border bg-surface p-3">
        <div className="mb-1.5">
          <CommentsSortDropdown sort={sort} onSortChange={setSort} />
        </div>
        <CommentComposer
          draft={draft}
          me={me}
          meAvatarStyle={meAvatarStyle}
          inputRef={composerRef}
          replyingToName={replyTarget?.authorName}
          placeholder={
            isSignedIn
              ? replyTarget
                ? `Reply to ${replyTarget.authorName}…`
                : "Add a comment…"
              : "Sign in to comment"
          }
          submitting={create.isPending}
          canSubmit={canSubmit}
          onDraftChange={setDraft}
          onClear={() => setDraft("")}
          onCancelReply={cancelReply}
          onSubmit={submitComment}
        />
      </div>
    </aside>
  )
}

function CommentRowView({
  comment,
  first,
  clipId,
  clipAuthorId,
  viewerId,
  depth,
  repliesOpen,
  isRepliesOpen,
  onToggleReplies,
  onStartReply,
}: {
  comment: CommentRow
  first?: boolean
  clipId: string
  clipAuthorId: string
  viewerId: string | null
  depth: number
  repliesOpen: boolean
  isRepliesOpen: (commentId: string) => boolean
  onToggleReplies: (commentId: string) => void
  onStartReply: (target: ReplyTarget) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
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
      toast.error("Sign in to like comments")
      return
    }
    toggleLike.mutate({
      commentId: comment.id,
      nextLiked: !comment.likedByViewer,
    })
  }

  function onPinToggle() {
    togglePin.mutate(
      { commentId: comment.id, nextPinned: !comment.pinned },
      {
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Couldn't pin")
        },
      }
    )
  }

  function onDelete() {
    del.mutate(
      { commentId: comment.id },
      {
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Couldn't delete")
        },
      }
    )
  }

  const authorName = displayName(comment.author)
  const avatarStyle = authorAvatarStyle(comment)
  const initials = displayInitials(authorName)
  const authorAvatarSrc = useAuthorAvatarSrc(comment.author)

  return (
    <li
      className={cn(
        "flex min-w-0",
        isTopLevel ? "gap-3 px-4 py-3" : "gap-2 py-2",
        isTopLevel && !first && "border-t border-border",
        comment.pinned &&
          "bg-[color-mix(in_oklab,var(--accent)_4%,transparent)]"
      )}
    >
      <Avatar
        size={isTopLevel ? "md" : "sm"}
        className="shrink-0"
        style={avatarStyle}
      >
        {authorAvatarSrc ? (
          <AvatarImage src={authorAvatarSrc} alt={authorName} />
        ) : null}
        <AvatarFallback style={avatarStyle}>{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {comment.pinned && isTopLevel && !isDeleted ? (
          <div className="inline-flex items-center gap-1 text-xs text-foreground-faint">
            <PinIcon className="size-3" />
            Pinned
          </div>
        ) : null}
        <div className="flex items-baseline gap-2 leading-none">
          <span className="text-[0.9375rem] font-semibold text-foreground">
            {authorName}
          </span>
          {comment.author.id === clipAuthorId ? (
            <span className="inline-flex items-center rounded-sm bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] leading-none font-semibold tracking-wide text-accent uppercase">
              Author
            </span>
          ) : null}
          <span className="text-xs text-foreground-faint">
            {formatRelativeTime(comment.createdAt)}
          </span>
          <CommentMenu
            canPin={canPin}
            canDelete={canDelete}
            deletePending={del.isPending}
            deleteTitle={
              isTopLevel ? "Delete this comment?" : "Delete this reply?"
            }
            deleteDescription="This will remove the comment text. Replies will stay visible."
            deleteActionLabel={isTopLevel ? "Delete comment" : "Delete reply"}
            pinned={comment.pinned}
            onPinToggle={onPinToggle}
            onDelete={onDelete}
          />
        </div>

        <CommentBody
          body={isDeleted ? "Deleted comment" : comment.body}
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
          onToggleLike={onToggleLike}
          onToggleReplies={() => onToggleReplies(comment.id)}
          onStartReply={() =>
            onStartReply({ id: comment.id, authorName: authorName })
          }
        />

        {repliesOpen && comment.replies.length > 0 ? (
          <ul
            className={cn(
              "mt-2 flex flex-col",
              depth < MAX_VISIBLE_REPLY_INDENT
                ? "border-l border-border pl-3"
                : "pl-0"
            )}
          >
            {comment.replies.map((reply) => (
              <CommentRowView
                key={reply.id}
                comment={reply}
                clipId={clipId}
                clipAuthorId={clipAuthorId}
                viewerId={viewerId}
                depth={depth + 1}
                repliesOpen={isRepliesOpen(reply.id)}
                isRepliesOpen={isRepliesOpen}
                onToggleReplies={onToggleReplies}
                onStartReply={onStartReply}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

export { ClipComments, type ClipCommentsProps }
