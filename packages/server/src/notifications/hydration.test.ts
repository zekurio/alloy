import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  notificationReferenceFields,
  type NotificationClipSource,
  type NotificationCommentSource,
} from "./hydration"

const ownerId = "11111111-1111-4111-8111-111111111111"
const viewerId = "22222222-2222-4222-8222-222222222222"
const clipId = "33333333-3333-4333-8333-333333333333"
const commentId = "44444444-4444-4444-8444-444444444444"

function clip(privacy: string): NotificationClipSource {
  return {
    id: clipId,
    authorId: ownerId,
    authorDisabledAt: null,
    privacy,
    status: "ready",
    title: "Current private title",
    thumbKey: "current-private-thumb.jpg",
  }
}

function comment(
  sourceClip: NotificationClipSource,
): NotificationCommentSource {
  return {
    id: commentId,
    body: "Current private comment",
    clipId: sourceClip.id,
    clip: sourceClip,
  }
}

test("notification hydration redacts current private clip and comment data", () => {
  const sourceClip = clip("private")

  assert.deepEqual(
    notificationReferenceFields(
      { id: viewerId, role: "user" },
      clipId,
      commentId,
      sourceClip,
      comment(sourceClip),
    ),
    { clip: null, commentId: null, commentSnippet: null },
  )
})

test("notification hydration keeps allowed public, unlisted, owner, and admin data", () => {
  for (const privacy of ["public", "unlisted"]) {
    const sourceClip = clip(privacy)
    const fields = notificationReferenceFields(
      { id: viewerId, role: "user" },
      clipId,
      commentId,
      sourceClip,
      comment(sourceClip),
    )
    assert.equal(fields.clip?.title, "Current private title")
    assert.equal(fields.commentSnippet, "Current private comment")
  }

  const privateClip = clip("private")
  for (const viewer of [
    { id: ownerId, role: "user" },
    { id: viewerId, role: "admin" },
  ]) {
    const fields = notificationReferenceFields(
      viewer,
      clipId,
      commentId,
      privateClip,
      comment(privateClip),
    )
    assert.equal(fields.clip?.title, "Current private title")
    assert.equal(fields.commentSnippet, "Current private comment")
  }
})

test("notification hydration checks a comment against its own clip", () => {
  const publicClip = clip("public")
  const privateCommentClip = {
    ...clip("private"),
    id: "55555555-5555-4555-8555-555555555555",
  }

  const fields = notificationReferenceFields(
    { id: viewerId, role: "user" },
    clipId,
    commentId,
    publicClip,
    comment(privateCommentClip),
  )

  assert.equal(fields.clip?.id, clipId)
  assert.equal(fields.commentId, null)
  assert.equal(fields.commentSnippet, null)
})
