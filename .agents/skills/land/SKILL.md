---
name: land
description: >-
  Lands the current Alloy changes on dev by branching, verifying, opening a
  squash-merged pull request on github.com/zekurio/alloy, and confirming the
  merge. Invoke only when the user has explicitly requested landing or merging
  the changes (e.g. the Land Changes button or "land this"), never for mere
  review, preparation, or passing checks.
metadata:
  delta-action: land
---

# Land changes on dev

This skill carries out an explicit request to land the thread's changes. The
request that invoked it already supplies merge intent: proceed through the
workflow without re-asking whether to merge. Stop only for genuine blockers
(failing checks, ambiguous conflicts, unresolved scope), not routine
reconfirmation.

`dev` is the only long-lived branch and the PR target
(`.github/CONTRIBUTING.md`, AGENTS.md). Publish to the `origin` remote
(github.com/zekurio/alloy); never push to the `local` backlink remote.

## 1. Preflight

- Run `git --no-optional-locks status` and `git fetch origin`. Identify what
  belongs to this thread's work. If the working tree mixes in unrelated
  changes, stop and ask which files to land rather than sweeping them up.
- If the changes are uncommitted, create a feature branch off `origin/dev` and
  commit them there. Branch names are at most three hyphen-separated words,
  without slashes or type prefixes (e.g. `session-recovery`); commits use
  conventional style `type(scope): summary` with types `feat`, `fix`, `docs`,
  `chore`, `refactor`, or `test` (source: `.github/CONTRIBUTING.md`,
  "Branches and Commits"). Prefix commits with `GIT_EDITOR=true`.
- If the branch is behind `origin/dev`, rebase onto it. Resolve conflicts
  automatically when the intended result is clear (user preference, recorded
  2026-02); preserve unrelated work. Pause and ask when resolution is
  ambiguous or would discard someone's work.

## 2. Verify locally

- Run `pnpm verify` (fmt check, lint, typecheck; source: root `package.json`
  `verify` script, also required by `.github/CONTRIBUTING.md` "Submitting a
  PR").
- Run `pnpm test` for affected areas, e.g.
  `pnpm test packages/server/src/path/to/file.test.ts` (source: root
  `package.json` `test` script → `vitest run`).
- Rust changes (`packages/desktop/recorder`, `packages/desktop/src-tauri`)
  build only on Windows; when `cargo` is unavailable locally, leave Rust
  validation to the `tauri desktop` CI workflow and say so in the PR's
  "How to Verify" section.
- Fix failures caused by this change before continuing. If a failure is
  pre-existing and unrelated, pause and ask.

## 3. Publish and open the PR

- Push the branch: `git push -u origin <branch>`.
- Open the PR against `dev` with `gh pr create --base dev`. The title uses the
  same conventional-commit style as commits; it drives the auto-applied
  `changelog:*` label (source: `.github/workflows/changelog-label.yml`). Add
  the `changelog:skip` label only when no release note is warranted.
- Fill in the template from `.github/pull_request_template.md`: What Changed,
  Why, How to Verify (state what was actually run), and Additional Notes.
  Delete the Screenshots section for non-UI changes.
- UI changes require before and after screenshots, attached with the GitHub
  CLI per AGENTS.md (`gh pr create --attach before.png --attach after.png`,
  or `gh pr comment <number> --attach ...`), never committed to the
  repository. If the installed `gh` lacks `--attach` (check
  `gh pr create --help`), pause and ask the user to attach them.

## 4. Wait for checks — all of them

- Watch with `gh pr checks <number> --watch`. Required-by-policy checks are
  whichever workflows this PR triggers: `checks` (`.github/workflows/test.yml`),
  and the path-filtered `nix` (`.github/workflows/nix.yml`) and
  `tauri desktop` (`.github/workflows/desktop-tauri.yml`) runs.
- `dev` has no branch protection or rulesets (verified via the GitHub API),
  so GitHub will not block a premature merge — this skill is the gate. Do not
  merge while any triggered check is pending, failing, or unverifiable, and
  never assume a check will pass. The passing checks must be for the head
  commit being merged, not an earlier push.
- On failures caused by this change, fix, push, and re-watch. Otherwise pause
  and ask.

## 5. Merge and confirm

- Squash-merge: `gh pr merge <number> --squash --delete-branch` (squash
  matches the `(#NNN)` single-commit history on `dev`; the repo does not
  auto-delete branches, so `--delete-branch` cleans up).
- Confirm the result: `git fetch origin` and check the squashed commit is
  reachable from `origin/dev` (e.g. `git log --oneline -3 origin/dev`).

## 6. Report the outcome

- In a subthread with `report_subthread_status` available, report there;
  otherwise report directly in the conversation.
- `status: "success"` only after step 5 confirms the commit on `origin/dev`.
  Title like `Landed on dev`; description one short line linking the squashed
  commit by short SHA and the CI result, using verified URLs only, e.g.
  `[abc1234](<commit-url>) · [CI passed](<ci-run-url>)`.
- `status: "failure"` for a failed attempt or genuine blocker, e.g.
  `Blocked by CI` with `[Tests failed](<ci-run-url>) for
[abc1234](<commit-url>). Not landed.` A prepared commit, pushed branch, or
  open PR is not success. Keep questions in the conversation, not the status
  event. Failure is not terminal — continue safe recovery when permitted and
  report the verified outcome.
