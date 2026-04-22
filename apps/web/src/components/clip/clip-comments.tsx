import * as React from "react"
import { PinIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { toast } from "@workspace/ui/components/sonner"
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
import type { CommentRow } from "@/lib/comments-api"
import {
  avatarTint,
  displayInitials,
  displayName,
  useUserChipData,
  type UserChipData,
} from "@/lib/user-display"
import {
  AuthorLikeBadge,
  CommentActions,
  CommentBody,
  CommentComposer,
  CommentLikeButton,
  CommentMenu,
  CommentsHeader,
  CommentsSortDropdown,
} from "./clip-comments-parts"
import { EmptyState } from "@/components/feedback/empty-state"

const LONG_COMMENT_CHARS = 260

interface ClipCommentsProps extends React.ComponentProps<"aside"> {
  clipId: string
  clipAuthorId: string
}

type Sort = "top" | "new"

function authorAvatarStyle(comment: CommentRow) {
  const { bg, fg } = avatarTint(comment.author.id || comment.author.name)
  return { background: bg, color: fg }
}

function useAuthorAvatarSrc(author: CommentRow["author"]): string | undefined {
  return author.image ?? undefined
}

function ClipComments({
  className,
  clipId,
  clipAuthorId,
  ...props
}: ClipCommentsProps) {
  const [draft, setDraft] = React.useState("")
  const [sort, setSort] = React.useState<Sort>("top")
  const { data: session } = useSession()
  const me = useUserChipData(session?.user)
  const viewerId = session?.user?.id ?? null
  const meAvatarStyle = {
    background: me.avatar.bg,
    color: me.avatar.fg,
  } as const

  const { data: comments = [], isLoading } = useCommentsQuery(clipId, sort)
  const create = useCreateCommentMutation(clipId)

  const totalCount = React.useMemo(
    () => comments.reduce((n, c) => n + 1 + c.replies.length, 0),
    [comments]
  )

  const isSignedIn = viewerId !== null
  const canSubmit = draft.trim().length > 0 && isSignedIn

  async function submitTopLevel() {
    const body = draft.trim()
    if (!body || !isSignedIn) return
    try {
      await create.mutateAsync({ body })
      setDraft("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post comment")
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
        {isLoading ? (
          <div className="flex h-full items-center justify-center p-6">
            <span className="text-xs text-foreground-faint">Loading…</span>
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
          <ul className="flex flex-col">
            {comments.map((comment, index) => (
              <CommentRowView
                key={comment.id}
                comment={comment}
                first={index === 0}
                clipId={clipId}
                clipAuthorId={clipAuthorId}
                viewerId={viewerId}
                me={me}
                meAvatarStyle={meAvatarStyle}
              />
            ))}
          </ul>
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
          placeholder={isSignedIn ? "Add a comment…" : "Sign in to comment"}
          submitting={create.isPending}
          canSubmit={canSubmit}
          onDraftChange={setDraft}
          onClear={() => setDraft("")}
          onSubmit={submitTopLevel}
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
  me,
  meAvatarStyle,
}: {
  comment: CommentRow
  first?: boolean
  clipId: string
  clipAuthorId: string
  viewerId: string | null
  me: UserChipData
  meAvatarStyle: { background: string; color: string }
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [replyOpen, setReplyOpen] = React.useState(false)
  const [repliesOpen, setRepliesOpen] = React.useState(false)
  const [replyDraft, setReplyDraft] = React.useState("")
  const isLong = comment.body.length > LONG_COMMENT_CHARS

  const toggleLike = useToggleCommentLikeMutation(clipId)
  const togglePin = useTogglePinCommentMutation(clipId)
  const del = useDeleteCommentMutation(clipId)
  const create = useCreateCommentMutation(clipId)

  const isViewerClipAuthor = viewerId !== null && viewerId === clipAuthorId
  const isCommentAuthor = viewerId !== null && viewerId === comment.author.id
  const canReply = viewerId !== null
  const canPin = isViewerClipAuthor && comment.parentId === null
  const canDelete = isCommentAuthor || isViewerClipAuthor

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

  async function submitReply() {
    const body = replyDraft.trim()
    if (!body) return
    try {
      await create.mutateAsync({ body, parentId: comment.id })
      setReplyDraft("")
      setReplyOpen(false)
      setRepliesOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post reply")
    }
  }

  const authorName = displayName(comment.author)
  const avatarStyle = authorAvatarStyle(comment)
  const initials = displayInitials(authorName)
  const authorAvatarSrc = useAuthorAvatarSrc(comment.author)

  return (
    <li
      className={cn(
        "flex gap-3 px-4 py-3",
        !first && "border-t border-border",
        comment.pinned &&
          "bg-[color-mix(in_oklab,var(--accent)_4%,transparent)]"
      )}
    >
      <Avatar size="md" className="shrink-0" style={avatarStyle}>
        {authorAvatarSrc ? (
          <AvatarImage src={authorAvatarSrc} alt={authorName} />
        ) : null}
        <AvatarFallback style={avatarStyle}>{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {comment.pinned ? (
          <div className="inline-flex items-center gap-1 text-xs text-foreground-faint">
            <PinIcon className="size-3" />
            Pinned
          </div>
        ) : null}
        <div className="flex items-center gap-2 leading-none">
          <span className="text-[0.9375rem] font-semibold text-foreground">
            {authorName}
          </span>
          {comment.author.id === clipAuthorId ? (
            <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-accent uppercase">
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
            deleteTitle="Delete this comment?"
            deleteDescription="This can't be undone."
            deleteActionLabel="Delete comment"
            pinned={comment.pinned}
            onPinToggle={onPinToggle}
            onDelete={onDelete}
          />
        </div>

        <CommentBody
          body={comment.body}
          expanded={expanded}
          isLong={isLong}
          edited={comment.editedAt !== null}
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
          onToggleLike={onToggleLike}
          onToggleReplies={() => setRepliesOpen((v) => !v)}
          onStartReply={() => setReplyOpen(true)}
        />

        {replyOpen ? (
          <div className="mt-2">
            <CommentComposer
              draft={replyDraft}
              me={me}
              meAvatarStyle={meAvatarStyle}
              placeholder={`Reply to ${authorName}…`}
              submitting={create.isPending}
              canSubmit={replyDraft.trim().length > 0}
              onDraftChange={setReplyDraft}
              onClear={() => {
                setReplyDraft("")
                setReplyOpen(false)
              }}
              onSubmit={submitReply}
            />
          </div>
        ) : null}

        {repliesOpen && comment.replies.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-3 border-l border-border pl-3">
            {comment.replies.map((reply) => (
              <ReplyRow
                key={reply.id}
                reply={reply}
                clipId={clipId}
                clipAuthorId={clipAuthorId}
                viewerId={viewerId}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

function ReplyRow({
  reply,
  clipId,
  clipAuthorId,
  viewerId,
}: {
  reply: CommentRow
  clipId: string
  clipAuthorId: string
  viewerId: string | null
}) {
  const [expanded, setExpanded] = React.useState(false)
  const isLong = reply.body.length > LONG_COMMENT_CHARS
  const toggleLike = useToggleCommentLikeMutation(clipId)
  const del = useDeleteCommentMutation(clipId)

  const isViewerClipAuthor = viewerId !== null && viewerId === clipAuthorId
  const isCommentAuthor = viewerId !== null && viewerId === reply.author.id
  const canDelete = isCommentAuthor || isViewerClipAuthor

  const authorName = displayName(reply.author)
  const avatarStyle = authorAvatarStyle(reply)
  const initials = displayInitials(authorName)
  const authorAvatarSrc = useAuthorAvatarSrc(reply.author)

  function onToggleLike() {
    if (!viewerId) {
      toast.error("Sign in to like comments")
      return
    }
    toggleLike.mutate({
      commentId: reply.id,
      nextLiked: !reply.likedByViewer,
    })
  }

  function onDelete() {
    del.mutate(
      { commentId: reply.id },
      {
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Couldn't delete")
        },
      }
    )
  }

  return (
    <li className="flex gap-2">
      <Avatar size="sm" className="shrink-0" style={avatarStyle}>
        {authorAvatarSrc ? (
          <AvatarImage src={authorAvatarSrc} alt={authorName} />
        ) : null}
        <AvatarFallback style={avatarStyle}>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 leading-none">
          <span className="text-[0.9375rem] font-semibold text-foreground">
            {authorName}
          </span>
          {reply.author.id === clipAuthorId ? (
            <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-accent uppercase">
              Author
            </span>
          ) : null}
          <span className="text-xs text-foreground-faint">
            {formatRelativeTime(reply.createdAt)}
          </span>
          {canDelete ? (
            <CommentMenu
              canPin={false}
              canDelete={canDelete}
              deletePending={del.isPending}
              deleteTitle="Delete this reply?"
              deleteDescription="This can't be undone."
              deleteActionLabel="Delete reply"
              pinned={false}
              onPinToggle={() => {}}
              onDelete={onDelete}
            />
          ) : null}
        </div>
        <CommentBody
          body={reply.body}
          expanded={expanded}
          isLong={isLong}
          edited={reply.editedAt !== null}
          onToggle={() => setExpanded((value) => !value)}
        />
        <div className="mt-0.5 flex items-center gap-2">
          <CommentLikeButton
            liked={reply.likedByViewer}
            likeCount={reply.likeCount}
            onClick={onToggleLike}
          />
          {reply.likedByAuthor && reply.author.id !== clipAuthorId ? (
            <AuthorLikeBadge />
          ) : null}
        </div>
      </div>
    </li>
  )
}

export { ClipComments, type ClipCommentsProps }
