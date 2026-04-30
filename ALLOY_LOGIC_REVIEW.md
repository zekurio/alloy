# Alloy Logic Review

Scope: API layer, auth/session layer, upload/storage/transcoding flow, and web logic that communicates with those areas. UI design was intentionally ignored. Findings are grouped by code area and function area.

## Fix Status

- [x] Global CSRF/origin protection for all cookie-auth mutation routes
- [x] Unified API request/error handling
- [ ] Persistent upload tickets, staging expiry, and orphan cleanup
- [ ] Stronger S3 upload size/content enforcement
- [x] Safer upload failure/retry lifecycle
- [ ] Encode job leases and final publication semantics
- [ ] Server-side image/thumbnail validation
- [ ] New clip form migration to TanStack Form
- [x] Realtime stream parsing and query fallback hardening

## Highest Priority

### 1. Cross-site request protection is incomplete outside auth

**Area:** server API mutation boundary, session-cookie auth.

**Risk:** High. Authenticated mutation routes use cookie credentials, but CSRF protection is only mounted inside the auth route. The app mounts CORS globally and then routes `/api/admin`, `/api/clips`, `/api/users`, and others separately. The existing CSRF middleware checks `Origin` for mutating methods, but it is only applied by `authRoute`, not globally.

**Why this matters:** `SameSite=Lax` helps, but it should not be the only control for state-changing endpoints. Browser behavior, top-level navigations, future cookie changes, and same-site subdomain deployments can all create holes. Admin config import, user deletion, clip deletion, follow/block, and upload finalization should all have the same request-origin policy.

**Proposed fix:**

- Move CSRF/origin enforcement to the API app before all `/api/*` routes, or create a protected mutation middleware used by every cookie-auth mutation route.
- Reject unsafe methods when both `Origin` and fetch metadata indicate a cross-site request.
- For high-impact routes, consider a double-submit CSRF token in addition to trusted origin checks.
- Keep the fs upload ticket route exempt only because it uses an explicit signed upload token and no session cookie.

### 2. API client behavior is split across two request stacks

**Area:** package API client, web-server communication contract.

**Risk:** Medium-high. The API package has a generic `createApiClient`/`readJsonOrThrow` path and a separate auth-specific `createAuth` path with its own request and response parsing. They differ in error shape handling, JSON validation strictness, content-type handling, and return conventions.

**Why this matters:** Auth actions return `{ data, error }` while other API functions throw `HttpError`. Some paths accept non-JSON success bodies silently, others fail if the response is not JSON. That inconsistency makes web-side error handling unreliable and makes it easier for new API methods to choose the wrong pattern.

**Proposed fix:**

- Collapse all request execution into one shared internal function that builds URLs, applies credentials, encodes JSON, parses JSON responses, and produces a single typed `ApiError` with `status` and `message`.
- Keep auth's public `{ data, error }` facade if desired, but implement it as a thin wrapper around the same core client.
- Add tests around non-JSON error responses, 204 responses, empty bodies, and malformed JSON.

### 3. Upload size enforcement differs sharply between fs and S3

**Area:** upload ticket minting, storage drivers, finalize flow.

**Risk:** High for hosted deployments using S3-compatible storage. The fs upload route enforces `maxBytes` while streaming and rejects reused tickets by hard-linking to the final path. S3 minting only signs `ContentLength` and `ContentType` on a presigned `PutObjectCommand`. Finalize later checks actual size with a tolerance, but a client can upload an oversized object and never finalize.

**Why this matters:** Object-store writes are a cost and capacity boundary. Even if finalize catches oversized objects, storage abuse can happen before finalize. The fs path and S3 path currently do not provide equivalent guarantees.

**Proposed fix:**

- Prefer a server-mediated multipart upload coordinator or presigned POST policies with an enforced content-length range where the provider supports it.
- Track upload tickets in the database with `clipId`, `key`, `expectedBytes`, `expiresAt`, and `usedAt`.
- Add a cleanup job for pending uploads and orphaned staging objects after `uploadTtlSec`.
- On finalize, require exact size or a very small transport-specific tolerance. The current tolerance is too large for quota enforcement.

**Status:** Partially fixed in this pass by making finalize require exact source size, validating resolved content type against the initiated type, and driving pending cleanup from runtime `uploadTtlSec`. Persistent upload-ticket rows and stronger provider-level S3 enforcement remain open.

### 4. Upload failure handling deletes the clip too aggressively on client errors

**Area:** web upload orchestration and server pending clip lifecycle.

**Risk:** Medium. The web flow initiates, uploads video, uploads thumbnail, then finalizes. On most caught errors, it deletes the clip row and sets local error state.

**Why this matters:** Failed uploads vanish server-side, so users cannot retry finalize or upload missing thumbnail after a transient network issue. It also means server-side failure records and notifications are bypassed in common client-error paths.

**Proposed fix:**

- Introduce explicit upload states: `pending`, `uploading`, `uploaded_video`, `uploaded_thumbnail`, `finalizing`, `failed`, `expired`.
- Add retry endpoints or make `finalize` idempotent for already-uploaded bytes.
- On client error, mark the clip failed through a dedicated endpoint instead of deleting the row automatically.
- Only delete on explicit user cancellation before bytes have been accepted, or when the user chooses remove.

### 5. Transcoding publishes partial `ready` states during variant generation

**Area:** encoder publish semantics, notification semantics, playback availability.

**Risk:** Medium. Remux and variant publishing can set `status: "ready"` before all desired variants are complete. The queue maps `ready` with `encodeProgress < 100` to "encoding", but playback/feed code sees a ready clip. Notifications are guarded against duplicate "new public clip" events, but the public data model still exposes a clip as ready while variants are still being produced.

**Proposed fix:**

- Split states into `playable` and `ready`, or add `playbackReadyAt` while keeping `status: "encoding"` until the final variant set is committed.
- Store variant generation progress separately from publication status.
- Only notify followers and publish into broad feeds once the intended final policy is reached.
- If early playback is a product requirement, make it explicit in contracts: e.g. `status: "playable_processing"` and `variantsFinal: false`.

## Auth And Session Layer

### 6. Session IP tracking trusts forwarded headers unconditionally

**Area:** session creation, audit metadata.

**Risk:** Low-medium today, higher if IP is later used for security decisions. Session creation records the first `x-forwarded-for` value directly.

**Proposed fix:**

- Only trust forwarded headers when a trusted proxy mode is enabled.
- Otherwise use the socket address from the runtime if available.
- Keep this field as audit-only unless proxy trust is configured.

### 7. Auth marker cookie is client-readable and can drift from session state

**Area:** web auth state hinting.

**Risk:** Low. The non-HTTP-only marker cookie is set alongside the real session and cleared with it, but it is not authoritative.

**Proposed fix:**

- Ensure web code treats it only as an optimization.
- Consider replacing it with a short-lived in-memory session bootstrap result or `/api/auth/session` cache.
- If retained, document the marker as untrusted and never gate UI privileges on it.

### 8. Origin checks should include configured public server origin

**Area:** CSRF/origin validation.

**Risk:** Medium. Current origin checks only compare against `TRUSTED_ORIGINS`. Misconfiguration could reject first-party calls or accidentally omit packaged deployments.

**Proposed fix:**

- Normalize and include `PUBLIC_SERVER_URL` origin in the trusted set automatically.
- Validate `TRUSTED_ORIGINS` as URL origins, not arbitrary strings.
- Add startup warnings when public URL and trusted origins disagree.

## Upload, Storage, And Media Validation

### 9. Media content type is trusted too early

**Area:** upload initiation, storage metadata, ffmpeg probing.

**Risk:** Medium. Initiation validates the declared MIME type and stores it. Actual media validation only happens later in `probe` during encoding. If probing fails, cleanup is worker-dependent.

**Proposed fix:**

- Treat client MIME as a hint only.
- After upload, probe before marking as `uploaded` or before queueing encode.
- Persist probed container/codec metadata separately from declared upload content type.
- Fail fast and delete staged bytes when probe rejects.

### 10. Client-generated thumbnails are trusted as JPEG bytes

**Area:** upload thumbnail path.

**Risk:** Medium. The server mints a JPEG thumbnail ticket and only checks that bytes exist. It does not decode or validate image content before making it the canonical thumbnail.

**Proposed fix:**

- Decode and validate thumbnails server-side, or generate thumbnails in the encoder.
- If client thumbnails remain, verify magic bytes, dimensions, and re-encode to a canonical JPEG/WebP before publication.
- Store thumbnail validation failures as upload failures with a clear retry path.

### 11. Base64 profile image uploads inflate memory and skip image decoding

**Area:** avatar/banner upload.

**Risk:** Medium. Avatar/banner uploads accept base64 JSON and decode whole buffers in memory. They validate size after decode and trust the declared content type.

**Proposed fix:**

- Replace base64 JSON uploads with the same upload-ticket/storage path used for clips, or at least multipart/form-data with streaming limits.
- Validate decoded image bytes with an image parser.
- Re-encode or strip metadata before storing public avatars/banners.

### 12. Pending upload quota accounting reserves declared size, not actual staged bytes

**Area:** quota enforcement.

**Risk:** Medium. Initiation reserves quota by declared `sizeBytes`. Finalize recomputes with resolved bytes, but abandoned pending clips can keep quota occupied until manually deleted.

**Proposed fix:**

- Add `expiresAt` to pending clips or upload tickets.
- Exclude expired pending rows from quota or reaper-delete them with staged objects.
- Show pending quota separately in the web storage UI.

**Status:** Partially fixed in this pass by aligning the pending reaper with `uploadTtlSec`. Explicit upload-ticket expiry rows remain open.

## Transcoding Flow

### 13. Encode jobs do not claim rows with a status transition

**Area:** worker idempotency and duplicate jobs.

**Risk:** Medium. Encoding updates rows by `clip.id` without a conditional status claim. Duplicate jobs can race, prune stale variants, and overwrite row state. Admin re-encode can enqueue batches without deduping existing jobs.

**Proposed fix:**

- Add a database-level encode lease: `encodeRunId`, `encodeLockedAt`, `encodeAttempt`.
- Workers should atomically claim `uploaded` rows and only update rows with the matching `encodeRunId`.
- Prune variants only after the winning run commits the final variant set.
- Deduplicate queue jobs by clip id where supported, or make the handler idempotent with leases.

### 14. Variant reuse compares array settings by reference

**Area:** variant reuse planning.

**Risk:** Low-medium performance issue. Variant setting comparison treats extra ffmpeg args as raw strings. Equivalent args with harmless whitespace differences can miss reuse and trigger unnecessary transcoding.

**Proposed fix:**

- Normalize variant settings into a stable hash.
- Compare normalized extra args by value.
- Store `settingsHash` on each variant and use it for reuse.

**Status:** Partially fixed in this pass by normalizing whitespace for extra arg comparison. A future migration can add a stored `settingsHash`.

## Web Logic, Forms, And React Patterns

### 15. The new clip form is hand-rolled instead of TanStack Form

**Area:** upload metadata form.

**Risk:** Medium maintainability issue. The upload dialog owns every metadata field with separate `useState` calls and a custom submit function. This diverges from the stated direction to stick with TanStack forms.

**Proposed fix:**

- Convert the metadata panel to TanStack Form with a shared schema that mirrors server initiation.
- Keep file/trim/player state outside the form, but pass derived trim fields into form submission.
- Reuse common validators from `apps/web/src/lib/form-validators.ts` and server contract constants.

### 16. Upload flow has callback dependency omissions

**Area:** React re-render correctness.

**Risk:** Low-medium. Some upload callbacks depend on context actions but omit them from dependency arrays. Setters are usually stable, but context actions should still be included for correctness and future provider changes.

**Proposed fix:**

- Include all context callbacks in dependency arrays.
- Prefer stable action objects in context providers, or split state/actions contexts if upload controls grow.

**Status:** Fixed for the upload publish callback in this pass.

### 17. Queue stream cannot recover from malformed SSE payloads

**Area:** server-web realtime communication.

**Risk:** Low-medium. EventSource handlers parse JSON without guards. A malformed event or incompatible deploy can throw in the event handler and leave cache state stale.

**Proposed fix:**

- Wrap event parsing in a narrow parser.
- On parse failure, mark the stream unhealthy and trigger a one-shot queue snapshot fetch endpoint.
- Add a real query fallback instead of an inert query function for upload queue hydration.

### 18. Query cache patching is broad and can over-invalidate

**Area:** React Query cache updates.

**Risk:** Low performance issue. Clip mutation helpers snapshot and patch many list/detail/infinite queries. This is correct but broad, and some mutations then invalidate all clip queries.

**Proposed fix:**

- Keep optimistic updates for visible detail/list caches, but target invalidation by affected surfaces: clip detail, current feed list, author profile lists.
- Add query key helpers for public feeds, viewer queue, and profile clips to avoid invalidating unrelated top clips.

## API/Admin Config

### 19. Runtime config import/export is too powerful as a single JSON endpoint

**Area:** admin config management.

**Risk:** Medium. Admin import merges arbitrary object input into current config and patches it. Runtime validation likely happens deeper, but the route itself accepts broad JSON.

**Proposed fix:**

- Validate import against a full explicit `RuntimeConfigSchema` before merging.
- Split secret-preserving import from full-secret import.
- Add audit events for config import/export and storage/OAuth/integration changes.
- Require a fresh-auth confirmation for import/export and storage driver changes.

## Suggested Fix Order

1. Add global CSRF/origin middleware for every cookie-auth mutation route.
2. Unify the API client request/error layer.
3. Add persistent upload tickets, pending upload expiry, and staging cleanup.
4. Harden S3 upload limits and finalize semantics.
5. Add encode leases/run IDs before expanding transcoding features.
6. Convert the new clip metadata form to TanStack Form using shared validators.
7. Validate/re-encode user images and thumbnails server-side.
8. Tighten realtime parsing and query invalidation after the API boundary is stable.
