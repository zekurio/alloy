import assert from "node:assert/strict"
import test from "node:test"

import {
  CLIP_ACCESS_POLICIES,
  evaluateClipAccess,
  type ClipAccessDecision,
  type ClipAccessPolicyName,
  type ClipViewer,
} from "./access-policy"

const authorId = "author"
const disabledAt = new Date("2026-01-01T00:00:00.000Z")

const policies = Object.keys(CLIP_ACCESS_POLICIES) as ClipAccessPolicyName[]
const privacies = ["public", "unlisted", "private"] as const
const statuses = ["ready", "processing"] as const
const viewers = [
  { name: "anonymous", viewer: null, isOwner: false, isAdmin: false },
  {
    name: "other user",
    viewer: { id: "u2", role: null },
    isOwner: false,
    isAdmin: false,
  },
  {
    name: "owner",
    viewer: { id: authorId, role: null },
    isOwner: true,
    isAdmin: false,
  },
  {
    name: "admin",
    viewer: { id: "u3", role: "admin" },
    isOwner: false,
    isAdmin: true,
  },
] as const satisfies readonly {
  name: string
  viewer: ClipViewer
  isOwner: boolean
  isAdmin: boolean
}[]

function decide(input: {
  policy: ClipAccessPolicyName
  viewer: ClipViewer
  privacy: string
  status: string
  authorDisabledAt?: Date | null
}): ClipAccessDecision {
  return evaluateClipAccess({
    authorId,
    authorDisabledAt: input.authorDisabledAt ?? null,
    policy: input.policy,
    privacy: input.privacy,
    status: input.status,
    viewer: input.viewer,
  })
}

test("public and unlisted ready clips from enabled authors are accessible", () => {
  for (const privacy of ["public", "unlisted"] as const) {
    for (const policy of policies) {
      for (const viewerCase of viewers) {
        assert.deepEqual(
          decide({
            policy,
            privacy,
            status: "ready",
            viewer: viewerCase.viewer,
          }),
          {
            accessible: true,
            isOwner: viewerCase.isOwner,
            isAdmin: viewerCase.isAdmin,
            isPrivate: false,
          },
          `${privacy} ${policy} ${viewerCase.name}`,
        )
      }
    }
  }
})

test("unlisted clip access is identical to public clip access", () => {
  for (const policy of policies) {
    for (const status of statuses) {
      for (const viewerCase of viewers) {
        for (const authorDisabledAt of [null, disabledAt]) {
          assert.deepEqual(
            decide({
              authorDisabledAt,
              policy,
              privacy: "unlisted",
              status,
              viewer: viewerCase.viewer,
            }),
            decide({
              authorDisabledAt,
              policy,
              privacy: "public",
              status,
              viewer: viewerCase.viewer,
            }),
            `${policy} ${status} ${viewerCase.name} disabled=${Boolean(
              authorDisabledAt,
            )}`,
          )
        }
      }
    }
  }
})

test("private clips deny non-owner and non-admin viewers by policy", () => {
  const nonBypassViewers = viewers.filter(
    (viewerCase) => !viewerCase.isOwner && !viewerCase.isAdmin,
  )

  for (const status of statuses) {
    for (const viewerCase of nonBypassViewers) {
      for (const policy of policies) {
        const expected =
          policy === "metadata"
            ? {
                accessible: false,
                error: "Not found",
                status: 404,
                isPrivate: true,
              }
            : {
                accessible: false,
                error: viewerCase.viewer ? "Forbidden" : "Unauthorized",
                status: viewerCase.viewer ? 403 : 401,
                isPrivate: true,
              }

        assert.deepEqual(
          decide({
            policy,
            privacy: "private",
            status,
            viewer: viewerCase.viewer,
          }),
          expected,
          `${policy} ${status} ${viewerCase.name}`,
        )
      }
    }
  }
})

test("private ready clips are accessible to owners and admins", () => {
  const bypassViewers = viewers.filter(
    (viewerCase) => viewerCase.isOwner || viewerCase.isAdmin,
  )

  for (const policy of policies) {
    for (const viewerCase of bypassViewers) {
      assert.deepEqual(
        decide({
          policy,
          privacy: "private",
          status: "ready",
          viewer: viewerCase.viewer,
        }),
        {
          accessible: true,
          isOwner: viewerCase.isOwner,
          isAdmin: viewerCase.isAdmin,
          isPrivate: true,
        },
        `${policy} ${viewerCase.name}`,
      )
    }
  }
})

test("disabled authors hide clips from non-owner and non-admin viewers", () => {
  const nonBypassViewers = viewers.filter(
    (viewerCase) => !viewerCase.isOwner && !viewerCase.isAdmin,
  )

  for (const privacy of privacies) {
    for (const status of statuses) {
      for (const policy of policies) {
        for (const viewerCase of nonBypassViewers) {
          assert.deepEqual(
            decide({
              authorDisabledAt: disabledAt,
              policy,
              privacy,
              status,
              viewer: viewerCase.viewer,
            }),
            {
              accessible: false,
              error: "Not found",
              status: 404,
              isPrivate: privacy === "private",
            },
            `${privacy} ${status} ${policy} ${viewerCase.name}`,
          )
        }
      }
    }
  }
})

test("disabled authors do not hide ready clips from owners or admins", () => {
  const bypassViewers = viewers.filter(
    (viewerCase) => viewerCase.isOwner || viewerCase.isAdmin,
  )

  for (const privacy of privacies) {
    for (const policy of policies) {
      for (const viewerCase of bypassViewers) {
        assert.deepEqual(
          decide({
            authorDisabledAt: disabledAt,
            policy,
            privacy,
            status: "ready",
            viewer: viewerCase.viewer,
          }),
          {
            accessible: true,
            isOwner: viewerCase.isOwner,
            isAdmin: viewerCase.isAdmin,
            isPrivate: privacy === "private",
          },
          `${privacy} ${policy} ${viewerCase.name}`,
        )
      }
    }
  }
})

test("non-ready status follows each policy readiness rule", () => {
  for (const privacy of ["public", "unlisted"] as const) {
    for (const viewerCase of viewers) {
      assert.deepEqual(
        decide({
          policy: "metadata",
          privacy,
          status: "processing",
          viewer: viewerCase.viewer,
        }),
        viewerCase.isOwner || viewerCase.isAdmin
          ? {
              accessible: true,
              isOwner: viewerCase.isOwner,
              isAdmin: viewerCase.isAdmin,
              isPrivate: false,
            }
          : {
              accessible: false,
              error: "Not found",
              status: 404,
              isPrivate: false,
            },
        `${privacy} metadata ${viewerCase.name}`,
      )

      assert.deepEqual(
        decide({
          policy: "ownerAsset",
          privacy,
          status: "processing",
          viewer: viewerCase.viewer,
        }),
        viewerCase.isOwner || viewerCase.isAdmin
          ? {
              accessible: true,
              isOwner: viewerCase.isOwner,
              isAdmin: viewerCase.isAdmin,
              isPrivate: false,
            }
          : {
              accessible: false,
              error: "Not found",
              status: 404,
              isPrivate: false,
            },
        `${privacy} ownerAsset ${viewerCase.name}`,
      )

      assert.deepEqual(
        decide({
          policy: "engagement",
          privacy,
          status: "processing",
          viewer: viewerCase.viewer,
        }),
        {
          accessible: false,
          error: "Not found",
          status: 404,
          isPrivate: false,
        },
        `${privacy} engagement ${viewerCase.name}`,
      )

      assert.deepEqual(
        decide({
          policy: "stream",
          privacy,
          status: "processing",
          viewer: viewerCase.viewer,
        }),
        {
          accessible: false,
          error: "Clip not ready",
          status: 404,
          isPrivate: false,
        },
        `${privacy} stream ${viewerCase.name}`,
      )
    }
  }
})

test("private non-ready status follows readiness after owner or admin bypass", () => {
  const bypassViewers = viewers.filter(
    (viewerCase) => viewerCase.isOwner || viewerCase.isAdmin,
  )

  for (const viewerCase of bypassViewers) {
    for (const policy of ["metadata", "ownerAsset"] as const) {
      assert.deepEqual(
        decide({
          policy,
          privacy: "private",
          status: "processing",
          viewer: viewerCase.viewer,
        }),
        {
          accessible: true,
          isOwner: viewerCase.isOwner,
          isAdmin: viewerCase.isAdmin,
          isPrivate: true,
        },
        `${policy} ${viewerCase.name}`,
      )
    }

    assert.deepEqual(
      decide({
        policy: "engagement",
        privacy: "private",
        status: "processing",
        viewer: viewerCase.viewer,
      }),
      {
        accessible: false,
        error: "Not found",
        status: 404,
        isPrivate: true,
      },
      `engagement ${viewerCase.name}`,
    )

    assert.deepEqual(
      decide({
        policy: "stream",
        privacy: "private",
        status: "processing",
        viewer: viewerCase.viewer,
      }),
      {
        accessible: false,
        error: "Clip not ready",
        status: 404,
        isPrivate: true,
      },
      `stream ${viewerCase.name}`,
    )
  }
})

test("disabled-author denial takes precedence over private auth denial", () => {
  for (const policy of policies) {
    assert.deepEqual(
      decide({
        authorDisabledAt: disabledAt,
        policy,
        privacy: "private",
        status: "ready",
        viewer: { id: "u2", role: null },
      }),
      {
        accessible: false,
        error: "Not found",
        status: 404,
        isPrivate: true,
      },
      policy,
    )
  }
})
