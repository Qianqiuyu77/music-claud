# AI Music Full Master Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local AI music workbench into a deployable C/B separated music product with QR login, silent first-use sync, user-private data isolation, shared public song knowledge, background AI tagging, lightweight continuous user profile, and one-shot proactive AI companion messages during playback.

**Architecture:** Keep `/` as the C-side listening product and `/admin` as the B-side operations product. Public song identity, metadata, and AI song tags are shared across users; NetEase cookies, login state, song sources, playback events, feedback, recommendation sessions, user profiles, and companion state are private per user. Each phase must leave the product runnable, tested, and visually/functionally compatible with the existing C-side unless the phase explicitly changes that behavior.

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite for the current prototype, repository/service layers under `src/lib`, Vitest unit tests, optional Playwright route smoke checks, NetEase Cloud Music QR/Cookie flow, existing AI provider abstraction.

---

## Product Decisions

- C side is for normal listening. It must not show raw Cookie, encrypted Cookie summaries, sync counts, model traces, AI tagging queue state, user profile internals, or admin diagnostics.
- B side is for owner/admin operations. It may show Cookie diagnostics, QR test tools, sync status, tagging queues, data health, and manual operational triggers.
- New users should start from `/`, scan a NetEase QR code, and reach playback without visiting `/admin`.
- First sync and AI tagging should be quiet. They must not block normal listening longer than necessary.
- AI song tags are public song knowledge. They are not personal user profile data.
- User profile is useful, but it supports the existing algorithm; it does not replace song tags, scene parsing, or recommendation ranking.
- A server deployment must not ship to real users until user-private data isolation is proven by tests.
- Raw NetEase Cookie must never be returned by API or rendered in UI.

## Current Status

- [x] Phase 1: B/C route and shell split.
- [x] Phase 2: QR Cookie persistence foundation.
- [x] Phase 3: C-side first-use onboarding and silent sync foundation.
- [x] Phase 4: multi-user isolation foundation.
- [x] Phase 5: public base library plus background AI tagging foundation.
- [~] Phase 6: lightweight continuous user profile.
- [~] Phase 7: proactive AI companion bubble.
- [~] Phase 8: deployment hardening and operational gates.

---

## Phase 1: B/C Route And Shell Split

**Goal:** Split C-side and B-side ownership without changing existing UI or behavior.

**Status:** Complete.

**Implemented shape:**

- `/` renders the consumer app shell.
- `/admin` renders the admin app shell.
- Both reuse the existing `Workbench` where appropriate.
- `/admin/cookie-test` remains available as a diagnostic test surface.

**Files:**

- `src/components/player/ConsumerMusicApp.tsx`
- `src/components/admin/AdminMusicApp.tsx`
- `src/app/page.tsx`
- `src/app/admin/page.tsx`
- `tests/unit/app-shells.test.tsx`

**Regression commands:**

```bash
npm test -- tests/unit/app-shells.test.tsx
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

---

## Phase 2: QR Cookie Persistence And Expiry Foundation

**Goal:** Make QR login produce a backend-usable NetEase Cookie while never exposing the raw Cookie to API/UI consumers.

**Status:** Complete as foundation.

**Implemented shape:**

- QR authorized status can provide the raw Cookie internally.
- Service layer persists the credential.
- API responses strip raw Cookie and return safe summaries only.
- `/admin/cookie-test` can force QR testing even when a backend Cookie already exists.

**Files:**

- `src/lib/netease/cloudProvider.ts`
- `src/lib/netease/types.ts`
- `src/lib/appServices.ts`
- `src/components/admin/CookieTestPanel.tsx`
- `src/app/admin/cookie-test/page.tsx`
- `src/app/api/login/diagnostics/route.ts`
- `tests/unit/providers.test.ts`
- `tests/unit/api-contracts.test.ts`
- `tests/unit/cookie-test-page.test.tsx`

**Remaining follow-up carried into later phases:**

- [x] Validate Cookie before user sync.
- [x] Mark expired Cookie in user-scoped login state.
- [x] Trigger C-side re-login when Cookie expires.

**Current expiry-state backend slice:**

- `GET /api/login/state` returns the current user's safe NetEase login state.
- `markUserLoginExpired(request, reason)` marks only the resolved current user's NetEase login state as expired.
- Safe login-state responses include provider, status, source, and verification time, but never return raw or encrypted Cookie.
- C-side first-use flow checks the safe login state and forces a fresh QR login when the saved state is expired.
- Expired login state does not trigger silent first-use sync.
- User sync validates the saved NetEase Cookie before import.
- Failed Cookie validation marks only the selected current user's login state as expired and returns a safe 401 sync response.

**Regression commands:**

```bash
npm test -- tests/unit/providers.test.ts -t "QR login"
npm test -- tests/unit/api-contracts.test.ts -t "login|Cookie|cookie|QR"
npm test -- tests/unit/cookie-test-page.test.tsx
npm run typecheck
```

**Current expiry-state verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "marks the selected user's NetEase login state as expired"
npm test -- tests/unit/api-contracts.test.ts -t "safe login state through an API route"
npm test -- tests/unit/workbench.test.tsx -t "fresh consumer QR login"
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/repositories.test.ts
npm run typecheck
```

**Current sync validation verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "Cookie validation fails|expired"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

---

## Phase 3: C-Side First Use And Silent Sync

**Goal:** A pure new user opens `/`, scans QR, and the app quietly prepares playable songs without exposing admin state.

**Status:** Complete as foundation.

**Implemented shape:**

- Consumer app enables silent first-use sync.
- C side shows QR login when no usable Cookie exists.
- QR authorized state transitions into a calm preparing state.
- Authorized empty library triggers `/api/sync` silently once.
- Sync success loads `/api/default-queue`.
- Admin mode does not auto-sync.

**Files:**

- `src/components/player/ConsumerMusicApp.tsx`
- `src/components/admin/AdminMusicApp.tsx`
- `src/components/workbench/Workbench.tsx`
- `tests/unit/workbench.test.tsx`

**Remaining tasks:**

- [x] Add or verify expired Cookie consumer re-login state.
- [x] Confirm C-side copy stays calm and non-technical.
- [x] Confirm C side does not show Cookie summary/debug/model/queue internals.
- [~] Smoke `/` with no Cookie, valid Cookie, expired Cookie, empty library, and existing library.

**Current first-use verification:** Passed on 2026-06-30 for the automated and local-live portions.

- Focused Workbench tests cover consumer QR first use, expired-login forced QR, QR authorization into silent first-use preparation, and loading the default queue after QR authorization finishes first-use sync.
- Focused API tests cover anonymous QR preview not inheriting the owner Cookie, QR-authorized Cookie persistence, pure new-user sync using the request user's QR Cookie instead of the owner Cookie, safe login state, and expired Cookie handling.
- Live local smoke on `http://127.0.0.1:3260` with a temporary SQLite database and no global `NETEASE_COOKIE` confirmed anonymous `GET /api/login/state` returns `missing`, anonymous `GET /api/login/qr` returns QR data URL JSON instead of `source: "cookie"`, and anonymous `GET /api/library` returns zero songs, zero playable songs, and `lastSyncAt: null`.
- Live C-side `/` returned a nonblank Next page and did not contain raw Cookie markers, credential summaries, admin tag queue paths, diagnostics wording, AI tagging wording, or user profile internals. The only `sync` hit in the HTML was the framework's `<script async>` attribute, not user-facing copy.
- The temporary `127.0.0.1:3260` listener and temporary SQLite database were removed after verification.
- Remaining manual external check: scan a real NetEase QR code in a browser, confirm the user-scoped Cookie is saved, and confirm silent sync reaches playback with the real provider.
- Current running-app playback polish: when the default queue loads and the browser blocks automatic playback, the C-side no longer shows the misleading "播放启动失败，请再点一次或换一首。" notice. The notice is still shown after a user-initiated play attempt fails, and failed stream errors still skip to the next song.

**Regression commands:**

```bash
npm test -- tests/unit/workbench.test.tsx -t "keeps autoplay failure quiet"
npm test -- tests/unit/workbench.test.tsx -t "playback|plays through|keeps playback|proactive companion|default queue|autoplay failure"
npm test -- tests/unit/workbench.test.tsx -t "silent first-use|first-use|fresh consumer QR login|forced QR status polling|default queue after QR authorization|QR authorization"
npm test -- tests/unit/api-contracts.test.ts -t "pure new user's library after QR authorization|QR-authorized NetEase cookies|anonymous QR login preview|Cookie validation fails|expired-route-sync|login state"
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/app-shells.test.tsx
npm test -- tests/unit/cookie-test-page.test.tsx
npm run typecheck
```

---

## Phase 4: Multi-User Data Isolation

**Goal:** Make the app safe for several users on one deployed server.

**Status:** Foundation complete; first deployed invite/session hardening slice complete.

**Core rule:**

```text
What a song is = public.
What a song means to one person = private.
```

**Implemented foundation:**

- Default owner user `id = 1`, `handle = "owner"`.
- `users.handle`.
- `user_login_states`.
- `user_song_sources`.
- `user_song_events`.
- `recommendation_sessions.user_id`.
- `UserRepository`.
- `resolveCurrentUser(db, request?)`.
- `POST /api/session`.
- User-scoped default queue, play events, feedback, recommendations, and login state.
- Recommendation sessions are isolated by user.

**Files:**

- `src/lib/db/schema.ts`
- `src/lib/repositories/userRepository.ts`
- `src/lib/repositories/musicRepository.ts`
- `src/lib/repositories/recommendationRepository.ts`
- `src/lib/appServices.ts`
- API routes under `src/app/api/**`
- `tests/unit/repositories.test.ts`
- `tests/unit/api-contracts.test.ts`

**Remaining tasks:**

- [x] Add request/session hardening for deployed use: invite code plus browser session is the recommended first version.
- [~] Ensure every private API route resolves or receives `userId`.
- [~] Add tests proving User A cannot see User B Cookie, sources, playback, feedback, sessions, or profile.
- [ ] Add migration notes for existing local owner data.
- [ ] Keep owner `id = 1` compatibility for local development.
- [x] Protect `/admin` behind owner-only access before real deployment.
- [x] Protect B-side operational API routes behind owner-only access before real deployment.

**Current invite/session hardening slice:**

- `POST /api/session` continues to create or reuse lightweight browser sessions for local development when no allowlist is configured.
- When `AI_MUSIC_INVITE_CODES` is configured, only comma-separated invite codes in that allowlist can create sessions.
- Rejected invite codes return 403 and do not set `ai_music_user`.
- Production browser session cookies include `HttpOnly`, `SameSite=Lax`, and `Secure`; local development keeps the same session flow without requiring HTTPS.

**Current private API userId audit slice:**

- Manual Cookie login route now resolves the current browser session user before saving NetEase login state.
- QR-authorized Cookie persistence now saves into the request user's login state instead of always using the default owner.
- Library expansion now resolves the current browser session user, uses only that user's private songs as NetEase expansion seeds, and writes expanded songs back only to that user's private sources.
- Library status now resolves the current browser session user and reports that user's private songs/playable songs, preventing new users from being treated as ready just because another user has songs.
- Recommendation and default-queue API readiness checks now use the current user's private library/login state instead of global song stats, preventing new users from inheriting owner readiness.
- Direct service calls still default to owner `id = 1` for local development compatibility.

**Current cross-user leakage fix slice:**

- Safe login-state API now has explicit coverage proving User B sees `missing` when only User A has a NetEase login state.
- QR login status, safe login state, and manual Cookie APIs do not return `rawCookie`, `encryptedCookie`, or another user's credential summary.
- Backend-Cookie login status responses also return only authorization state and source, not a reversible local credential summary.
- The admin Cookie test page no longer renders QR credential summaries; it only shows authorization state and safe diagnostics.
- Removed the service-level global in-memory feedback cache because it could make User A feedback appear in User B recommendations for a shared public song row.
- Recommendations now rely on the current user's user-scoped feedback loaded from `user_song_events`.
- Feedback writes now verify the target song exists in the current user's private library before saving.
- If a user guesses another user's private song id and submits feedback, `/api/feedback` returns 404 and does not create a private event.
- Playback writes now verify the target song exists in the current user's private library before saving.
- If a user guesses another user's private song id and submits playback progress, `/api/play-events` returns 404 and does not create a private event or refresh the wrong profile.
- Lyrics reads now verify the requested song exists in the current user's private library before calling the lyrics provider.
- Playback proxy reads now verify the requested song exists in the current user's private library before resolving fresh media URLs or fetching audio bytes.

**Current admin protection slice:**

- `isOwnerUser()` treats only `id = 1` with handle `owner` as the admin owner.
- `canAccessAdmin(request)` resolves the browser session user and allows only the owner.
- `/admin` returns `notFound()` for non-owner sessions instead of rendering B-side diagnostics.
- `/api/tags`, `/api/tags/queue`, `/api/tags/queue/process`, `/api/login/diagnostics`, `/api/profiles/status`, `/api/login/cookie`, and `/api/expand` return 404 for non-owner browser sessions.
- C-side QR login, QR status polling, login state, library status, silent sync, default queue, recommendations, playback events, feedback, companion, and lyrics remain user-scoped C-side APIs instead of owner-only APIs.
- Owner fallback remains compatible with local development when no user cookie exists.

**Current B-side API protection verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "blocks non-owner browser sessions"
npm test -- tests/unit/api-contracts.test.ts -t "tag queue|manual library tagging"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current profile diagnostics protection verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "profile diagnostics"
npm test -- tests/unit/api-contracts.test.ts -t "admin profile freshness"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current manual Cookie and expansion protection verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "manually saving cookies|manually expanding|persists manually saved NetEase cookies"
npm test -- tests/unit/workbench.test.tsx -t "backend-cookie login replace|manual admin action|expand"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current recommendation/default-queue readiness verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "readiness inherit the owner library"
npm test -- tests/unit/api-contracts.test.ts -t "recommendation API|default liked queue through an API route|request user's private library"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Acceptance criteria:**

- [ ] Two users can share one public song row.
- [ ] User A and User B can have different sources for the same song.
- [ ] User A feedback does not affect User B recommendations.
- [ ] User A playback cooldown does not affect User B.
- [ ] User A recommendation sessions are not readable by User B.
- [ ] Raw Cookie is never returned by API.

**Regression commands:**

```bash
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current login-state isolation verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "request user's login state"
npm test -- tests/unit/api-contracts.test.ts -t "expands the request user's private library"
npm test -- tests/unit/api-contracts.test.ts -t "library status from the request user's private library"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current invite/session verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "configured invite codes"
npm test -- tests/unit/api-contracts.test.ts -t "Secure on browser session"
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current cross-user leakage verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "in-memory feedback"
npm test -- tests/unit/api-contracts.test.ts -t "another user's login state"
npm test -- tests/unit/api-contracts.test.ts -t "backend Cookie exists"
npm test -- tests/unit/api-contracts.test.ts -t "QR-authorized NetEase cookies"
npm test -- tests/unit/cookie-test-page.test.tsx
npm test -- tests/unit/workbench.test.tsx -t "QR|login|Cookie"
npm test -- tests/unit/api-contracts.test.ts -t "another user's private song"
npm test -- tests/unit/api-contracts.test.ts -t "playback for another user's private song"
npm test -- tests/unit/api-contracts.test.ts -t "read playback for another|read lyrics for another"
npm test -- tests/unit/playback-route.test.ts
npm test -- tests/unit/lyrics-route.test.ts
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current live multi-user isolation smoke:** Passed on 2026-06-30 against an isolated local production-style server on `http://127.0.0.1:3270`.

- Focused repository tests verified browser session cookie resolution, unknown-session handling without owner fallback, and owner-user detection.
- Focused API tests verified configured invite codes, production `Secure` browser session cookies, owner-only admin access, anonymous admin blocking in deployed mode, non-owner blocking for admin APIs, request-user private library readiness, no owner-library inheritance, private-song access checks, login-state isolation, and user-scoped feedback memory.
- The live smoke used a temporary SQLite database, `AI_MUSIC_INVITE_CODES=alpha-private,beta-private`, no global `NETEASE_COOKIE` in the launched process, and production-mode session hardening.
- `POST /api/session` rejected `wrong-code` with 403 and accepted `alpha-private`, returning a safe `ai_music_user=2` browser session for the friend user.
- Friend session `GET /api/library` returned zero songs, zero playable songs, and `lastSyncAt: null`; `GET /api/login/state` returned `missing`, confirming the friend did not inherit the owner login state.
- Friend session received 404 from `/admin`, `/api/login/diagnostics`, and `/api/tags/queue`.
- Unknown `ai_music_user=999` received 404 from `/admin` and `GET /api/library` returned zero songs, zero playable songs, and `lastSyncAt: null`, confirming unknown sessions do not fall back to owner data.
- Owner session `ai_music_user=1` could still access `/api/login/diagnostics` and `/api/tags/queue?limit=1`, preserving B-side owner operations.
- The live response scan found no `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `encryptedCookie`, or `rawCookie` markers in the checked JSON/API responses.
- The temporary `127.0.0.1:3270` listener and temporary SQLite database were removed after verification.

Verification commands:

```bash
npm test -- tests/unit/repositories.test.ts -t "browser session cookies|owner user"
npm test -- tests/unit/api-contracts.test.ts -t "configured invite codes|Secure on browser session|owner browser session|anonymous admin access|blocks non-owner browser sessions|request user's private library|readiness inherit the owner library|another user's private song|playback for another user's private song|another user's login state|in-memory feedback"
$env:NODE_ENV='production'; $env:APP_BASE_URL='http://127.0.0.1:3270'; $env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; $env:DEEPSEEK_API_KEY='<fake secret>'; $env:NETEASE_USE_REAL_LOGIN='1'; $env:NETEASE_DEVICE_ID='stable-device-id'; $env:AI_MUSIC_INVITE_CODES='alpha-private,beta-private'; $env:TAGGING_WORKER_SECRET='<fake worker secret>'; $env:PORT='3270'; $env:HOSTNAME='127.0.0.1'; npm run start
node --input-type=module <live isolation smoke script>
```

---

## Phase 5: Public Base Library And Background AI Tagging

**Goal:** Let new users benefit from already stored songs while missing AI tags are generated in the background.

**Status:** Foundation complete.

**Implemented shape:**

- `tagging_jobs` schema and indexes.
- `TaggingQueueRepository`.
- Missing AI tag jobs can be enqueued, claimed, marked done, marked failed, counted, and listed.
- Sync/expand paths enqueue missing public song tag jobs.
- Queue batch processor exists.
- Admin queue endpoint exists.
- `/admin` can view and manually process the tag queue.
- C side does not show the admin queue panel.
- Untagged playable songs can still enter default queue/recommendations with lower confidence.

**Files:**

- `src/lib/db/schema.ts`
- `src/lib/repositories/taggingQueueRepository.ts`
- `src/lib/repositories/musicRepository.ts`
- `src/lib/appServices.ts`
- `src/app/api/tags/queue/route.ts`
- `src/components/admin/TagQueuePanel.tsx`
- `tests/unit/repositories.test.ts`
- `tests/unit/api-contracts.test.ts`
- `tests/unit/workbench.test.tsx`

**Remaining tasks:**

- [x] Add a timed/background worker option for server deployment.
- [x] Add queue retry/backoff policy if external AI tagging fails.
- [x] Add admin visibility for repeated failures without exposing C-side details.
- [x] Add operational limits to avoid accidental runaway tagging cost.

**Current queue cost-control slice:**

- Tag queue processing clamps each batch to `TAGGING_QUEUE_BATCH_LIMIT`.
- If `TAGGING_QUEUE_BATCH_LIMIT` is not configured or invalid, one batch processes at most 20 jobs.
- A manual admin request with a larger `limit` cannot exceed the configured max batch size.

**Current queue retry/backoff slice:**

- Failed tag jobs are requeued as `pending` until `TAGGING_QUEUE_MAX_ATTEMPTS` is reached.
- Requeued jobs set `next_attempt_at` and are not claimed again until the retry delay has elapsed.
- `TAGGING_QUEUE_RETRY_DELAY_SECONDS` controls retry delay; default is 300 seconds.
- `TAGGING_QUEUE_MAX_ATTEMPTS` controls max attempts; default is 3.
- Jobs only move to `failed` after the final configured attempt.

**Current admin failure visibility slice:**

- `/admin` tag queue rows show each job's attempt count as admin-only operational metadata.
- C-side player mode still does not render the tag queue panel or retry details.

**Current deployment worker slice:**

- `POST /api/workers/tagging` processes the public AI tagging queue without requiring an admin browser session.
- The worker endpoint requires `Authorization: Bearer <TAGGING_WORKER_SECRET>` and rejects missing or wrong secrets with 401.
- `npm run worker:tagging` calls the worker endpoint using `APP_BASE_URL`, `TAGGING_WORKER_SECRET`, and optional `TAGGING_WORKER_LIMIT`.
- This gives server cron/scheduled jobs a quiet way to keep public song tags moving in the background while C-side playback remains unaffected.

**Current worker live smoke:** Passed on 2026-06-30 against an isolated local production-style server on `http://127.0.0.1:3280`.

- Focused API tests verified worker-secret enforcement, scheduled worker processing without an admin browser session, batch caps, pending-job processing, retry/backoff for failed jobs, admin queue status, and non-owner tag queue blocking.
- Focused Workbench tests verified tag queue operations render only in admin mode and admin queue processing refreshes status.
- Live smoke used a temporary SQLite database, production-mode session hardening, no global `NETEASE_COOKIE` in the launched process, and `TAGGING_WORKER_SECRET=worker-live-secret-long`.
- `POST /api/workers/tagging` returned 401 with no secret and 401 with an incorrect secret.
- `POST /api/workers/tagging` returned 200 with the correct secret and safe numeric counts: zero processed, zero succeeded, zero failed, zero songs for an empty queue.
- `APP_BASE_URL=http://127.0.0.1:3280 TAGGING_WORKER_SECRET=worker-live-secret-long TAGGING_WORKER_LIMIT=2 npm run worker:tagging` successfully called the same worker endpoint and returned safe count JSON.
- Live C-side `/` returned 200 and did not contain raw Cookie markers, tag queue paths, tagging wording, queue wording, diagnostics wording, or admin worker vocabulary.
- Unknown `ai_music_user=999` still received 404 from `/api/tags/queue`.
- The live response scan found no `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `encryptedCookie`, or `rawCookie` markers in checked responses.
- The temporary `127.0.0.1:3280` listener and temporary SQLite database were removed after verification.

**Acceptance criteria:**

- [ ] Owner's tagged songs become a reusable public base library.
- [ ] A new user's first sync is faster when songs already exist.
- [ ] Untagged songs do not block playback.
- [ ] AI tagging never blocks first-use listening.
- [ ] C side remains unaware of tagging queue internals.

**Current queue cost-control verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "caps tag queue processing"
npm test -- tests/unit/api-contracts.test.ts -t "processes pending tagging jobs|tag queue processing endpoint|tag queue"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current queue retry/backoff verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/repositories.test.ts -t "retries failed tagging jobs"
npm test -- tests/unit/api-contracts.test.ts -t "requeues failed tag jobs|caps tag queue processing|processes pending tagging jobs"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current admin failure visibility verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/workbench.test.tsx -t "shows tag queue operations only in admin mode"
```

**Current deployment worker verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "worker secret|scheduled worker secret"
npm test -- tests/unit/api-contracts.test.ts -t "requires a worker secret|scheduled worker secret|caps tag queue processing|requeues failed tag jobs|processes pending tagging jobs|tag queue processing endpoint|tag queue status|blocks non-owner browser sessions from tag queue"
npm test -- tests/unit/workbench.test.tsx -t "shows tag queue operations only in admin mode|processes the tag queue from admin mode"
$env:NODE_ENV='production'; $env:APP_BASE_URL='http://127.0.0.1:3280'; $env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; $env:DEEPSEEK_API_KEY='<fake secret>'; $env:NETEASE_USE_REAL_LOGIN='1'; $env:NETEASE_DEVICE_ID='stable-device-id'; $env:AI_MUSIC_INVITE_CODES='alpha-private,beta-private'; $env:TAGGING_WORKER_SECRET='worker-live-secret-long'; $env:TAGGING_WORKER_LIMIT='2'; $env:PORT='3280'; $env:HOSTNAME='127.0.0.1'; npm run start
$env:APP_BASE_URL='http://127.0.0.1:3280'; $env:TAGGING_WORKER_SECRET='worker-live-secret-long'; $env:TAGGING_WORKER_LIMIT='2'; npm run worker:tagging
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Regression commands:**

```bash
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

---

## Phase 6: Lightweight Continuous User Profile

**Goal:** Add private preference memory that improves recommendations over time without becoming a heavy personality system.

**Status:** Complete as current lightweight foundation; longer-term quality tuning can continue after deployment smoke.

**Implemented foundation:**

- `user_profiles` schema.
- `UserProfileRepository`.
- Deterministic `userProfileBuilder`.
- `refreshUserProfile(userId)` service.
- Tests for user-private profile storage and profile building from one user's private signals.

**Immediate next slice: recommendation integration**

- [x] Add helper in `src/lib/appServices.ts` to load existing `user_profiles` for the current request user.
- [x] Pass stored profile data into `AiProvider.summarizePreference(profileData)` when profile exists.
- [x] Pass the returned preference summary into `parseListeningContext(input, profileSummary)`.
- [x] Preserve current behavior when profile is missing: skip preference summary and call `parseListeningContext(input, "")`.
- [x] Keep profile internals out of C-side UI.

**Files:**

- `src/lib/db/schema.ts`
- `src/lib/repositories/userProfileRepository.ts`
- `src/lib/profile/userProfileBuilder.ts`
- `src/lib/appServices.ts`
- `tests/unit/repositories.test.ts`
- `tests/unit/api-contracts.test.ts`
- `tests/unit/workbench.test.tsx`

**Remaining tasks after recommendation integration:**

- [x] Refresh profile after meaningful sync.
- [x] Refresh profile after explicit feedback.
- [x] Refresh profile after enough playback events.
- [x] Add stale-profile detection before recommendation.
- [x] Add optional AI compaction after deterministic profile assembly.
- [x] Add admin-only diagnostics for profile freshness/confidence, not raw personal detail.

**Acceptance criteria:**

- [x] Profile is optional.
- [x] Profile is private per user.
- [x] Profile uses private sources, playback, and feedback plus public tags.
- [x] Negative feedback changes the profile.
- [x] Recommendations still work when profile is missing.
- [x] Existing algorithm remains the core; profile only adds preference context.

**TDD commands for current slice:**

```bash
npm test -- tests/unit/api-contracts.test.ts -t "stored user profile"
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/workbench.test.tsx
npm run typecheck
```

**Current slice verification:** Passed on 2026-06-30.

**Current optional AI profile compaction verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "optionally saves an AI-compacted profile summary"
npm test -- tests/unit/api-contracts.test.ts -t "optionally saves an AI-compacted profile summary|profile|recommendation"
npm test -- tests/unit/api-contracts.test.ts -t "AI compaction|profile summary"
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current Phase 6 acceptance verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "profile|Profile|recommendation|feedback|playback|sync"
npm test -- tests/unit/repositories.test.ts -t "profile|profiles|private signals"
npm test -- tests/unit/workbench.test.tsx -t "profile diagnostics|clean player page"
```

Evidence covered:

- Missing profiles skip AI preference summary and recommendations still run.
- Profiles are refreshed after sync, explicit feedback, and significant playback.
- User A and User B profiles are built from their own private libraries/signals.
- Negative feedback appears in the user's deterministic profile summary.
- Admin profile diagnostics expose freshness/confidence/summary length only, not raw profile detail.
- C-side player remains free of profile diagnostics.

**Current profile isolation and integration verification:** Passed on 2026-06-30.

- Repository tests verified `user_profiles` stores owner and friend profiles separately and builds each profile only from that user's private signals plus public song tags.
- Service/API tests verified `refreshUserProfile(userId)` uses only the selected user's private library, optional AI compaction preserves deterministic profile data, and compaction failure falls back to deterministic summaries.
- Feedback, significant playback, sync, missing-profile recommendation requests, and stale-profile recommendation requests all refresh the selected user's profile instead of another user's profile.
- Recommendation context parsing receives the current user's stored profile summary when available and skips preference summary when no profile exists.
- Proactive companion prompts use the selected user's profile summary and responses do not return `compactSummary` or `profileJson`.
- Admin profile diagnostics expose only freshness/confidence/summary length and block non-owner browser sessions.

Verification commands:

```bash
npm test -- tests/unit/repositories.test.ts -t "stores user profiles separately"
npm test -- tests/unit/api-contracts.test.ts -t "refreshes a user profile from that user's private library only|AI-compacted profile|deterministic profile summary|passes the stored user profile summary|refreshes the user profile after explicit feedback|refreshes the user profile after significant playback|refreshes the selected user's profile after sync|syncs from the request user and refreshes that user's profile|refreshes a missing user profile before recommendations|refreshes a stale user profile before recommendations|admin profile freshness|blocks non-owner browser sessions from profile diagnostics|selected user's profile summary for proactive companion|skips preference summary when no user profile data exists"
```

---

## Phase 7: Proactive AI Companion Bubble

**Goal:** Let AI say one short contextual sentence during playback without interrupting the user.

**Status:** UI and service-level personalized first slice complete; longer-term quality tuning remains.

**Implemented first slice:**

- `RecommendationPanel` triggers a proactive companion request from playback `timeupdate`.
- Threshold is 30 seconds or 35% of song duration, whichever is later.
- The player calls `/api/companion/proactive` with current song, tags, lyric line, playback position, and chat history.
- `/api/companion/proactive` resolves the current user and injects that user's private profile summary into the companion prompt.
- The proactive response returns only the message/raw AI response, not raw profile detail.
- The bubble is hidden before threshold and appears only after a companion message returns.
- The same song item triggers only once in the current queue instance.
- Clicking the bubble opens the existing companion chat and inserts that proactive message once.
- Failed proactive requests stay silent and never interrupt playback.

**Behavior:**

```text
Song is playing
-> playback reaches threshold
-> generate one short companion message
-> show small bubble near player/cover area
-> tap opens chat with that message
```

**Initial trigger rule:**

- Trigger at 30 seconds or 35% of song duration, whichever is later for short songs.
- Trigger once per song play.
- Do not auto-open chat.
- Do not pause playback.
- Do not repeat for the same song play.

**Files likely touched:**

- `src/app/api/companion/proactive/route.ts`
- Player/chat components under `src/components/workbench`
- `src/lib/appServices.ts`
- `src/lib/proactiveCompanionRoute.ts`
- AI provider types/prompts under `src/lib`
- `tests/unit/workbench.test.tsx`
- `tests/unit/api-contracts.test.ts`

**Tasks:**

- [x] Add failing test: bubble does not appear before threshold.
- [x] Add failing test: bubble appears once after threshold.
- [x] Add failing test: bubble does not repeat for the same song play.
- [x] Add failing test: tapping bubble opens chat.
- [x] Add companion message service using current song, public tags, recent user profile summary, and playback context.
- [x] Add UI bubble state tied to current song id and playback progress.
- [x] Add prompt constraints: short, contextual, no invented facts, no interruption.
- [x] Ensure service is user-scoped.

**Acceptance criteria:**

- [x] AI feels present during playback.
- [x] Player is never interrupted.
- [x] Chat opens only when user taps.
- [x] Bubble respects multi-user context.
- [x] C-side UI remains visually consistent except for this intentional feature.

**Verification commands:**

```bash
npm test -- tests/unit/workbench.test.tsx -t "companion|bubble"
npm test -- tests/unit/api-contracts.test.ts -t "companion"
npm run typecheck
```

**Current slice verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/workbench.test.tsx -t "proactive companion"
npm test -- tests/unit/api-contracts.test.ts -t "proactive companion prompts"
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current proactive companion behavior verification:** Passed on 2026-06-30.

- Focused Workbench tests verified the proactive companion request is not sent before the playback threshold, is sent once after the threshold, does not repeat for the same song item, renders the bubble only after a message returns, and opens the existing companion chat when the user taps the bubble.
- The same Workbench test group verified companion chat still sends current song context and keeps player controls available.
- Focused API tests verified the companion endpoint receives current song, lyric, playback, and history context.
- Proactive companion API tests verified the selected user's private profile summary is used for prompt construction while the response does not return `compactSummary`, `profileJson`, or another user's profile/song signal.
- Failed proactive requests remain a front-end silent path by design and do not interrupt playback.

Verification commands:

```bash
npm test -- tests/unit/workbench.test.tsx -t "proactive companion|companion chat"
npm test -- tests/unit/api-contracts.test.ts -t "AI companion endpoint|selected user's profile summary for proactive companion|proactive companion prompts|uses the selected user's profile summary"
```

**Current runtime companion smoke:** Passed on 2026-06-30 with a documented browser boundary.

- A separate isolated dev server on `127.0.0.1:3230` used a temporary SQLite database seeded with one private liked/playable/AI-tagged song for the owner user.
- `GET /api/default-queue?limit=12` returned the seeded song with `streamUrl: "/api/playback?id=companion-smoke-1"`, `songs: 1`, `playableSongs: 1`, and public AI tags.
- `POST /api/companion/proactive` with current song and playback position returned a short companion message and did not return profile internals, raw Cookie, or credential material.
- Browser smoke loaded the C-side player with the seeded song and an audio element.
- The seeded fake upstream audio URL could not actually play, so the live page could not naturally advance playback time; the player showed a playback failure notice but remained usable and did not expose sensitive text.
- The browser automation surface is read-only for page state, so it could not mutate the real `audio.currentTime` to force the `timeupdate` trigger. The actual bubble trigger remains covered by the component test that fires real React `timeUpdate` events: before threshold no request, after threshold exactly one request, bubble appears, and tapping it opens chat.
- The temporary `127.0.0.1:3230` dev server and temporary SQLite database were removed after verification.

Verification commands:

```bash
curl.exe -s --max-time 5 "http://127.0.0.1:3230/api/default-queue?limit=12"
curl.exe -i --max-time 8 -H "Content-Type: application/json" --data-binary "@-" http://127.0.0.1:3230/api/companion/proactive
npm test -- tests/unit/workbench.test.tsx -t "proactive companion"
npm test -- tests/unit/api-contracts.test.ts -t "proactive companion prompts|companion endpoint"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

---

## Phase 8: Deployment Hardening

**Goal:** Make the project deployable on a server without accidental data leakage or fragile local-only assumptions.

**Status:** Automated gate complete for the current private-prototype deployment shape; manual server smoke remains before real deployment.

**Tasks:**

- [x] Choose first deployment database mode: SQLite with backup for private prototype, or Postgres if concurrency becomes important.
- [x] Add production environment variable checklist.
- [x] Add database backup/restore procedure.
- [x] Add migration verification command.
- [x] Protect `/admin` behind owner-only access.
- [x] Add invite allowlist for deployed browser session creation.
- [x] Validate user-scoped Cookie storage in deployed mode.
- [x] Add Cookie expiry/re-login smoke path.
- [x] Add route smoke checks for `/`, `/admin/cookie-test`, login diagnostics, default queue, recommendations, and tag queue admin route.
- [x] Add build gate with `npm run build`.
- [x] Confirm raw Cookie never appears in logs, UI preview text, or API JSON.

**Current Cookie expiry/re-login progress:**

- [x] Add backend safe login-state API.
- [x] Add backend ability to mark selected current user's Cookie as expired.
- [x] Test that expired-state API never exposes raw or encrypted Cookie.
- [x] Connect C-side Workbench to `/api/login/state`.
- [x] Show calm QR re-login surface when state is expired.
- [x] Prevent silent sync from running while login state is expired.
- [x] Validate Cookie before sync and mark expired when provider verification fails.

**Current deployment operations slice:**

- `docs/deployment.md` documents the first deployment mode as private SQLite with backups, with Postgres deferred until concurrency requires it.
- The production environment checklist covers `MUSIC_DB_PATH`, `AI_MUSIC_INVITE_CODES`, `TAGGING_WORKER_SECRET`, `APP_BASE_URL`, `DEEPSEEK_API_KEY`, NetEase QR login flags, and tag queue limits.
- `npm run db:check` opens the configured SQLite database, creates/checks baseline tables, and verifies core tables exist.
- `npm run db:backup` writes a timestamped backup of the configured SQLite database.
- The deployment gate now explicitly includes `npm run build`, `npm run db:check`, the deployment docs contract test, and automated deployment route smoke tests.
- `tests/unit/deployment-smoke.test.tsx` renders the C-side home page and admin Cookie test page, then verifies critical API statuses for owner and non-owner sessions.
- Raw Cookie safety is documented as a deploy acceptance requirement.
- Admin Cookie diagnostics accept pasted Cookie input, but the page no longer has a separate "show full Cookie" preview; tests prove manually pasted tokens are not rendered outside the input.
- API tests cover safe login state, QR login status, manual Cookie persistence, and expired-Cookie responses without returning raw or encrypted credential material.
- Non-owner manual Cookie persistence and QR-authorized Cookie persistence now write only to that user's private `user_login_states` row and do not replace the owner/global bootstrap `NETEASE_COOKIE`.
- Owner/default-owner Cookie persistence still preserves local development compatibility by updating `process.env.NETEASE_COOKIE` and `.env.local`.
- User sync now reads the selected user's active stored NetEase Cookie from `user_login_states` and passes it into the NetEase provider, so a deployed non-owner user can sync without relying on the global owner/bootstrap `NETEASE_COOKIE`.
- Owner/default-owner sync still falls back to the global `NETEASE_COOKIE` for local development compatibility when no active stored login state exists.
- Playback URL refresh and lyrics fetch routes now pass the selected user's active stored NetEase Cookie into their service/provider calls after verifying the song belongs to that user.
- Owner/default-owner playback and lyrics still fall back to the global `NETEASE_COOKIE` for local development compatibility when no active stored login state exists.
- Library expansion now reads the selected user's active stored NetEase Cookie and passes it into the NetEase provider, while still using only that user's private seed songs.
- Main runtime NetEase calls now follow the same user-cookie override pattern: sync, expansion, playback URL refresh, and lyrics fetches. Future NetEase calls should follow the same rule instead of reading the global environment directly.

**Acceptance criteria:**

- [ ] Server can host more than one user safely.
- [ ] Admin features are unavailable to normal C-side users.
- [ ] Cookie expiry/re-login works.
- [ ] Backup/migration path is documented.
- [ ] Full test/type/build gate passes before deployment.

**Verification commands:**

```bash
npm test
npm run typecheck
npm run build
```

**Current admin protection verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/repositories.test.ts -t "default owner as an admin user"
npm test -- tests/unit/api-contracts.test.ts -t "owner browser session"
npm test -- tests/unit/app-shells.test.tsx
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current C-side expired-login verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/workbench.test.tsx -t "fresh consumer QR login"
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
```

**Current deployment operations verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/deployment-docs.test.ts
npm test -- tests/unit/deployment-smoke.test.tsx
npm test -- tests/unit/cookie-test-page.test.tsx
npm test -- tests/unit/api-contracts.test.ts -t "Cookie|cookie|login state|QR-authorized"
$env:MUSIC_DB_PATH=':memory:'; npm run db:check
npm run build
npm run typecheck
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
```

**Current user-scoped Cookie storage verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "non-owner NetEase cookies|request user's login state"
npm test -- tests/unit/api-contracts.test.ts -t "Cookie|cookie|login state|QR-authorized|QR login"
npm test -- tests/unit/cookie-test-page.test.tsx
npm run typecheck
```

**Current user-scoped QR preview verification:** Passed on 2026-06-30.

- `GET /api/login/qr` now resolves the current browser session user before deciding whether a saved NetEase login exists.
- A non-owner user with only a private stored NetEase Cookie, and no global bootstrap Cookie, receives the safe `source: "cookie"` QR preview instead of being sent back to QR login.
- An anonymous C-side request with no `ai_music_user` session no longer inherits the owner/global bootstrap Cookie; it gets a real QR preview when real login is enabled, so pure new users start from scan login.
- The response still does not expose raw Cookie, `encryptedCookie`, or local credential material.
- Existing owner/global bootstrap Cookie behavior remains compatible for local development.

Verification commands:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "anonymous QR login preview|QR preview|QR login preview|cookie-authorized|non-owner user's stored login state"
npm test -- tests/unit/workbench.test.tsx -t "consumer QR login|silent first-use|forced QR status|default queue after QR authorization"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

**Current pure-new-user QR-to-playback closure:** Passed on 2026-06-30.

- `GET /api/login/status?key=...&force=1` persists a QR-authorized NetEase Cookie into the request user's private login state.
- `POST /api/sync` immediately after QR authorization uses that same user's stored Cookie, not the owner/global bootstrap Cookie.
- Imported songs are attached to the new user's private library and do not appear in the owner library.
- The API response does not expose the QR raw Cookie or encrypted credential material.
- C-side first-use UI can move from QR authorization, through silent sync, into the default playback queue without showing Cookie or sync internals.

Verification commands:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "pure new user's library after QR authorization|QR-authorized|stored NetEase Cookie when no global Cookie exists|syncs with the request user's stored"
npm test -- tests/unit/workbench.test.tsx -t "default queue after QR authorization|silent first-use|QR authorization"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

**Current pure-new-user runtime entry smoke:** Passed on 2026-06-30.

- A separate isolated dev server on `127.0.0.1:3210` with `MUSIC_DB_PATH=:memory:`, empty `NETEASE_COOKIE`, and `NETEASE_USE_REAL_LOGIN=1` simulated a pure new user entry.
- Anonymous `GET /api/login/state` returned `login.status = "missing"`.
- Anonymous `GET /api/library` returned zero songs, zero playable songs, and `lastSyncAt: null`.
- Anonymous `GET /api/login/qr` returned a real QR data URL.
- C-side `/` included the first-use QR copy `先连上你的网易云音乐` and `连接后就能为你挑歌`.
- C-side `/` did not include `Cookie`, `MUSIC_U`, `local-dev:`, `encryptedCookie`, `rawCookie`, `tags/queue`, `画像`, or `诊断`.
- The temporary `127.0.0.1:3210` dev server was stopped after verification.

Verification commands:

```bash
curl.exe -s --max-time 5 http://127.0.0.1:3210/api/login/state
curl.exe -s --max-time 5 http://127.0.0.1:3210/api/library
curl.exe -s --max-time 5 http://127.0.0.1:3210/api/login/qr
curl.exe -s --max-time 5 http://127.0.0.1:3210/
npm test -- tests/unit/api-contracts.test.ts -t "pure new user's library after QR authorization|QR-authorized|stored NetEase Cookie when no global Cookie exists|syncs with the request user's stored"
npm test -- tests/unit/workbench.test.tsx -t "default queue after QR authorization|silent first-use|QR authorization"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

**Current expired-login reauth closure:** Passed on 2026-06-30.

- C-side first-use login checks `/api/login/state`; when the saved NetEase login is expired, it requests `/api/login/qr?force=1`.
- QR status polling now preserves that forced-login intent by calling `/api/login/status?key=...&force=1`, avoiding accidental fallback to an owner/global bootstrap Cookie during reauth.
- After the forced QR status returns `authorized`, C-side silent sync resumes and loads the default playback queue.
- The player still does not show raw Cookie, Cookie debug text, or sync internals during the reauth path.

Verification commands:

```bash
npm test -- tests/unit/workbench.test.tsx -t "forced QR status polling|fresh consumer QR login|default queue after QR authorization|silent first-use|QR authorization"
npm test -- tests/unit/api-contracts.test.ts -t "expired|QR-authorized|login state|pure new user's library after QR authorization"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

**Current expired-login runtime smoke:** Passed on 2026-06-30.

- A separate isolated dev server on `127.0.0.1:3220` used a temporary SQLite database seeded with an owner NetEase login state marked `expired`.
- Anonymous `GET /api/login/state` returned `status: "expired"` and `source: "cookie"` without returning raw or encrypted credential material.
- Anonymous `GET /api/login/qr?force=1` returned a real QR data URL for re-login.
- Anonymous `GET /api/library` returned zero songs, zero playable songs, and `lastSyncAt: null`.
- C-side `/` still rendered calm first-use/re-login copy and did not show `Cookie`, `MUSIC_U`, the seeded credential marker, `local-dev:`, `encryptedCookie`, `rawCookie`, `tags/queue`, `画像`, or `诊断`.
- The temporary `127.0.0.1:3220` dev server and temporary SQLite database were removed after verification.

Verification commands:

```bash
curl.exe -s --max-time 5 http://127.0.0.1:3220/api/login/state
curl.exe -s --max-time 5 "http://127.0.0.1:3220/api/login/qr?force=1"
curl.exe -s --max-time 5 http://127.0.0.1:3220/api/library
curl.exe -s --max-time 5 http://127.0.0.1:3220/
npm test -- tests/unit/workbench.test.tsx -t "forced QR status polling|fresh consumer QR login|default queue after QR authorization|silent first-use|QR authorization"
npm test -- tests/unit/api-contracts.test.ts -t "expired|QR-authorized|login state|pure new user's library after QR authorization"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

**Current C/B browser smoke and hardening slice:** Passed on 2026-06-30 with:

- C-side `/` renders an empty first-use state with calm product copy and no visible Cookie, credential summary, profile internals, tag queue, or sync-state wording.
- C-side empty state now says `先连上你的网易云音乐` / `连接后就能为你挑歌` / `扫码登录后会自动准备你的音乐，不需要手动处理。`
- Unknown or stale `ai_music_user` cookies no longer fall back to owner for admin authorization.
- Non-owner/unknown sessions receive 404 from `/admin`, `/api/login/diagnostics`, and `/api/tags/queue` when sent as a real Cookie header.
- `/api/login/diagnostics` no longer returns a `MUSIC_U=...` or `MUSIC_A=...` Cookie preview; it reports configured/valid/account only.
- Browser smoke confirmed `/admin/cookie-test` does not render raw Cookie, encrypted credential summaries, or `local-dev:` credential text.

Verification commands:

```bash
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/cookie-test-page.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
curl.exe -i -H "Cookie: ai_music_user=999" http://localhost:3001/admin
curl.exe -i -H "Cookie: ai_music_user=999" http://localhost:3001/api/login/diagnostics
curl.exe -i -H "Cookie: ai_music_user=999" http://localhost:3001/api/tags/queue
```

**Current user-scoped sync Cookie verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "stored NetEase Cookie when no global Cookie exists"
npm test -- tests/unit/api-contracts.test.ts -t "sync|Cookie validation|expired-route-sync|stored NetEase Cookie"
npm test -- tests/unit/api-contracts.test.ts -t "Cookie|cookie|login state|QR-authorized|QR login|sync"
npm test -- tests/unit/providers.test.ts
npm run typecheck
```

**Current user-scoped playback/lyrics Cookie verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/playback-route.test.ts -t "stored NetEase Cookie"
npm test -- tests/unit/lyrics-route.test.ts -t "stored NetEase Cookie"
npm test -- tests/unit/playback-route.test.ts
npm test -- tests/unit/lyrics-route.test.ts
npm test -- tests/unit/api-contracts.test.ts -t "read playback for another|read lyrics for another|Cookie|cookie|login state"
npm test -- tests/unit/providers.test.ts
npm run typecheck
```

**Current user-scoped expansion Cookie verification:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "expands the request user's private library"
npm test -- tests/unit/api-contracts.test.ts -t "expand|Cookie|cookie|login state|sync"
npm test -- tests/unit/providers.test.ts
npm test -- tests/unit/api-contracts.test.ts -t "recommendation|AI|default liked|profile|companion"
npm test -- tests/unit/playback-route.test.ts tests/unit/lyrics-route.test.ts
npm run typecheck
```

**Current full automated deployment gate:** Passed on 2026-06-30 with:

```bash
npm test -- tests/unit/api-contracts.test.ts
npm run typecheck
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/app-shells.test.tsx
npm test -- tests/unit/cookie-test-page.test.tsx
npm test -- tests/unit/playback-route.test.ts tests/unit/lyrics-route.test.ts
npm test -- tests/unit/providers.test.ts
npm test -- tests/unit/deployment-docs.test.ts tests/unit/deployment-smoke.test.tsx
npm test
$env:MUSIC_DB_PATH=':memory:'; npm run db:check
npm run build
```

**Latest deployment gate verification:** Passed on 2026-06-30 after aligning repository tests with the deployed security rule that unknown `ai_music_user` cookies must not fall back to owner.

```bash
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/app-shells.test.tsx tests/unit/cookie-test-page.test.tsx tests/unit/deployment-docs.test.ts tests/unit/deployment-smoke.test.tsx
npm test -- tests/unit/playback-route.test.ts tests/unit/lyrics-route.test.ts tests/unit/providers.test.ts
npm test -- --reporter=dot
npm run typecheck
$env:MUSIC_DB_PATH=':memory:'; npm run db:check
npm run build
```

Fresh evidence:

- Full Vitest suite: 14 files, 208 tests passed.
- TypeScript check passed with `tsc --noEmit`.
- SQLite deployment check passed against `:memory:`.
- Next production build completed successfully and includes `/`, `/admin`, `/admin/cookie-test`, C-side APIs, B-side APIs, and `/api/workers/tagging`.

**Latest private deployment preparation gate:** Passed on 2026-06-30.

- `scripts/check-db.mjs` now reuses the application database client and real `migrate(db)` from `src/lib/db/schema.ts` instead of maintaining a separate hand-written schema copy, reducing deployment drift risk.
- Deployment docs tests cover that `db:check` uses the application migration.
- Full Vitest suite passed with 14 files and 216 tests.
- TypeScript check passed with `tsc --noEmit`.
- Next production build completed successfully and includes `/`, `/admin`, `/admin/cookie-test`, all C-side APIs, B-side APIs, `/api/companion/proactive`, and `/api/workers/tagging`.
- `npm run db:check` passed against `:memory:` and a temporary real SQLite file path.
- `npm run db:backup` wrote a timestamped backup to a temporary backup directory, proving the backup script can copy the checked SQLite database.
- `scripts/production-smoke.mjs` is wired as `npm run smoke:production` and checks C-side home, safe login state, anonymous QR safety, unknown-user admin blocking, profile diagnostics blocking, worker secret rejection, and forbidden credential marker leakage.
- A separate isolated service on `127.0.0.1:3240` with `MUSIC_DB_PATH=:memory:`, `AI_MUSIC_INVITE_CODES=friend-alpha`, empty `NETEASE_COOKIE`, `NETEASE_USE_REAL_LOGIN=1`, and `TAGGING_WORKER_SECRET=unit-worker-secret` passed `APP_BASE_URL=http://127.0.0.1:3240 npm run smoke:production`. The temporary listener was stopped after verification.
- `scripts/release-check.mjs` is wired as `npm run release:check` and runs the pre-deploy gate in order: tests, typecheck, production environment check, production build, and database schema check. The runner isolates test/typecheck from production secrets and deployment switches, then uses the configured production environment for deploy/build/database checks.
- `docs/deploy/ai-music.service`, `docs/deploy/ai-music-tagging-worker.service`, `docs/deploy/ai-music-tagging-worker.timer`, and `docs/deploy/nginx-ai-music.conf` now provide copy-and-edit private server templates for the app process, scheduled public song tagging worker, and HTTPS reverse proxy.
- `docs/deploy/production.env.example` now provides a safe server environment template with placeholders only and no raw credential markers, and `docs/deployment.md` references it as the server environment starting point.
- `package.json` now exposes `npm run start` as `next start`, matching the systemd app service `ExecStart`.
- `npm run release:check` passed with fake production secrets and a temporary persistent SQLite file path. The gate verified 14 test files and 220 tests, TypeScript, production env shape, Next production build, and database schema migration.
- `scripts/check-production-env.mjs` now rejects unmodified placeholder values such as `replace-with...`, example domains, and default invite-code examples like `owner-code` and `friend-code`, while still avoiding secret echo in output.
- `tests/unit/deployment-docs.test.ts` covers the placeholder rejection path and a non-placeholder passing production environment.
- Fresh `npm run release:check` passed with non-placeholder fake production values, `AI_MUSIC_INVITE_CODES=alpha-private,beta-private`, and a temporary persistent SQLite file path. The gate verified 14 test files and 220 tests, TypeScript, production env shape, Next production build, and database schema migration.
- `docs/deploy/private-server-runbook.md` now provides the ordered private server deployment procedure: directories, server-only environment file, release gate, systemd app service, HTTPS Nginx proxy, production smoke, manual worker pass, scheduled tag worker, browser smoke, and rollback.
- `tests/unit/deployment-docs.test.ts` covers that the runbook includes the required server commands and safety invariants for placeholder replacement, invite codes, worker secret, raw Cookie markers, and unknown/non-owner admin blocking.
- A local production simulation passed on `http://127.0.0.1:3250` with a temporary persistent SQLite file, production-mode session hardening variables, `AI_MUSIC_INVITE_CODES=alpha-private,beta-private`, empty global NetEase Cookie, and `TAGGING_WORKER_SECRET=fake-worker-secret-long`.
- The local simulation verified `npm run release:check` first, then started `npm run start` on the isolated port and ran `APP_BASE_URL=http://127.0.0.1:3250 npm run smoke:production`.
- Production smoke passed all checks: C-side home, anonymous safe login state, anonymous safe QR preview, unknown-user admin blocking, unknown-user diagnostics blocking, unknown-user tag queue blocking, unknown-user profile diagnostics blocking, and worker missing-secret rejection.
- The temporary `127.0.0.1:3250` listener, temporary release SQLite database, and temporary server SQLite database were removed after verification.
- Fresh full `npm run release:check` passed after the first-use, multi-user isolation, worker, profile, and proactive companion smoke iterations. The gate verified 14 test files and 221 tests, TypeScript, production env shape, Next production build, and database schema migration against a temporary persistent SQLite file.
- The fresh release gate used non-placeholder fake production values, `APP_BASE_URL=https://music.private-test.local`, `AI_MUSIC_INVITE_CODES=alpha-private,beta-private`, `TAGGING_WORKER_SECRET=fake-worker-secret-long`, and `TAGGING_WORKER_LIMIT=2`.
- After the fresh release gate, the temporary SQLite database was removed and ports `3250`, `3260`, `3270`, and `3280` had no remaining listeners.

Verification commands:

```bash
npm test -- tests/unit/deployment-docs.test.ts
$env:MUSIC_DB_PATH=':memory:'; npm run db:check
npm test
npm run typecheck
npm run build
$env:NODE_ENV='production'; $env:APP_BASE_URL='https://music.private-test.local'; $env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; $env:DEEPSEEK_API_KEY='<fake secret>'; $env:NETEASE_USE_REAL_LOGIN='1'; $env:NETEASE_DEVICE_ID='stable-device-id'; $env:AI_MUSIC_INVITE_CODES='alpha-private,beta-private'; $env:TAGGING_WORKER_SECRET='<fake worker secret>'; npm run release:check
$env:NODE_ENV='production'; $env:APP_BASE_URL='https://music.private-test.local'; $env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; $env:DEEPSEEK_API_KEY='<fake secret>'; $env:NETEASE_USE_REAL_LOGIN='1'; $env:NETEASE_DEVICE_ID='stable-device-id'; $env:AI_MUSIC_INVITE_CODES='alpha-private,beta-private'; $env:TAGGING_WORKER_SECRET='fake-worker-secret-long'; $env:TAGGING_WORKER_LIMIT='2'; npm run release:check
npm test -- tests/unit/deployment-docs.test.ts -t "ordered private server deployment runbook"
npm test -- tests/unit/deployment-docs.test.ts
npm run typecheck
$env:NODE_ENV='production'; $env:APP_BASE_URL='https://music.private-test.local'; $env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; $env:DEEPSEEK_API_KEY='<fake secret>'; $env:NETEASE_USE_REAL_LOGIN='1'; $env:NETEASE_DEVICE_ID='stable-device-id'; $env:AI_MUSIC_INVITE_CODES='alpha-private,beta-private'; $env:TAGGING_WORKER_SECRET='<fake worker secret>'; npm run release:check
$env:NODE_ENV='production'; $env:APP_BASE_URL='http://127.0.0.1:3250'; $env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; $env:DEEPSEEK_API_KEY='<fake secret>'; $env:NETEASE_USE_REAL_LOGIN='1'; $env:NETEASE_DEVICE_ID='stable-device-id'; $env:AI_MUSIC_INVITE_CODES='alpha-private,beta-private'; $env:TAGGING_WORKER_SECRET='<fake worker secret>'; $env:PORT='3250'; $env:HOSTNAME='127.0.0.1'; npm run start
$env:APP_BASE_URL='http://127.0.0.1:3250'; npm run smoke:production
$env:APP_BASE_URL='http://127.0.0.1:3240'; npm run smoke:production
$env:MUSIC_DB_PATH='<temp sqlite path>'; npm run db:check
$env:MUSIC_DB_PATH='<temp sqlite path>'; $env:MUSIC_DB_BACKUP_DIR='<temp backup dir>'; npm run db:backup
```

**Latest manual smoke continuation:** Passed on 2026-06-30 against `http://localhost:3100` with one small privacy polish applied.

- C-side `/` rendered a nonblank listening page with no visible `Cookie`, credential summary, profile internals, tag queue wording, sync-state wording, `local-dev:`, or raw NetEase token markers.
- `/admin/cookie-test` rendered the diagnostic surface without raw Cookie, encrypted credential summary, `local-dev:`, or raw NetEase token markers.
- Unknown `ai_music_user=999` received 404 from `/admin`, `/api/login/diagnostics`, and `/api/tags/queue`.
- API leak scan for `/api/login/state`, `/api/login/diagnostics`, `/api/default-queue`, and `/api/tags/queue` found no `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `encryptedCookie`, or `rawCookie`.
- Unknown user C-side state returned `login.status = "missing"`, private library counts of zero, and no inherited owner `lastSyncAt`.
- Fixed `getStoredLibraryStatus()` so a user with no private songs gets `lastSyncAt: null` instead of the global library sync timestamp.

Verification commands:

```bash
curl.exe -I --max-time 5 http://localhost:3100/
curl.exe -i -H "Cookie: ai_music_user=999" http://localhost:3100/admin
curl.exe -i -H "Cookie: ai_music_user=999" http://localhost:3100/api/login/diagnostics
curl.exe -i -H "Cookie: ai_music_user=999" http://localhost:3100/api/tags/queue
curl.exe -s -H "Cookie: ai_music_user=999" http://localhost:3100/api/library
npm test -- tests/unit/api-contracts.test.ts -t "reports library status from the request user's private library"
npm test -- tests/unit/api-contracts.test.ts -t "readiness inherit the owner library|request user's private library|login state|blocks non-owner browser sessions"
npm test -- tests/unit/workbench.test.tsx -t "proactive companion"
npm test -- tests/unit/api-contracts.test.ts -t "proactive companion prompts"
npm run typecheck
```

**Latest anonymous QR and deployed admin hardening slice:** Passed on 2026-06-30 in automated verification and live HTTP smoke.

- Live anonymous `GET /api/login/state` returned `login.status = "missing"`.
- Live anonymous `GET /api/login/qr` returned a real QR data URL and did not return `source: "cookie"`, proving anonymous C-side users no longer inherit the owner/global Cookie for QR preview in the running app.
- Live C-side `/` rendered the calm first-use copy with no visible `Cookie`, raw token markers, credential summaries, profile internals, tag queue wording, AI tagging wording, or diagnostics.
- Live unknown `ai_music_user=999` requests returned 404 for `/admin`, `/api/login/diagnostics`, `/api/tags/queue`, and `/api/profiles/status`.
- Live API leak scan for `/api/login/state`, `/api/login/diagnostics`, `/api/default-queue`, `/api/tags/queue`, and `/api/login/qr` found no `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `encryptedCookie`, or `rawCookie`.
- Added deployed-admin hardening: when `AI_MUSIC_INVITE_CODES` is configured or `NODE_ENV=production`, admin access now requires an explicit owner `ai_music_user` session instead of falling back to owner for anonymous requests.
- Local development compatibility remains: without deployment session hardening, anonymous admin service calls can still fall back to owner for local owner workflows.
- A separate isolated dev server on `127.0.0.1:3200` with `AI_MUSIC_INVITE_CODES=friend-alpha` and `MUSIC_DB_PATH=:memory:` verified anonymous `/admin`, `/api/login/diagnostics`, `/api/tags/queue`, and `/api/profiles/status` return 404.
- The same isolated deployment-mode server verified explicit owner session requests with `Cookie: ai_music_user=1` still return 200 for `/api/login/diagnostics`, `/api/tags/queue?limit=1`, and `/api/profiles/status`.
- The temporary `127.0.0.1:3200` dev server was stopped after verification.

Verification commands:

```bash
curl.exe -s --max-time 5 http://localhost:3100/api/login/state
curl.exe -s --max-time 5 http://localhost:3100/api/login/qr
curl.exe -s --max-time 5 "http://localhost:3100/api/login/qr?force=1"
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=999" http://localhost:3100/admin
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=999" http://localhost:3100/api/login/diagnostics
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=999" http://localhost:3100/api/tags/queue
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=999" http://localhost:3100/api/profiles/status
curl.exe -i --max-time 5 http://127.0.0.1:3200/api/login/diagnostics
curl.exe -i --max-time 5 http://127.0.0.1:3200/api/tags/queue
curl.exe -i --max-time 5 http://127.0.0.1:3200/api/profiles/status
curl.exe -i --max-time 5 http://127.0.0.1:3200/admin
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=1" http://127.0.0.1:3200/api/login/diagnostics
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=1" http://127.0.0.1:3200/api/tags/queue?limit=1
curl.exe -i --max-time 5 -H "Cookie: ai_music_user=1" http://127.0.0.1:3200/api/profiles/status
npm test -- tests/unit/api-contracts.test.ts -t "anonymous admin access|owner browser session|login diagnostics|tag queue status|profile diagnostics"
npm test -- tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx tests/unit/deployment-smoke.test.tsx
npm run typecheck
```

---

## Recommended Execution Order From Now

1. Prepare first private server deployment using the documented SQLite backup and worker setup.
2. Before deployment, run the full gate: `npm test`, `npm run typecheck`, `npm run build`, and `npm run db:check`.
3. After deployment, run production smoke checks for multi-user isolation, C/B permissions, sync, playback, lyrics, recommendations, companion, and tag worker.

## First Private Server Deployment Checklist

Use this checklist for the next concrete iteration. Do not open the server to other users until every smoke item passes.

- [ ] Pick the private server origin and set `APP_BASE_URL`.
- [ ] Create persistent directories for the SQLite database and backups, for example `/srv/ai-music/data` and `/srv/ai-music/backups`.
- [ ] Copy `docs/deploy/production.env.example` to the server-only environment file and replace every placeholder without committing the filled file.
- [ ] Configure production environment variables without printing secrets: `NODE_ENV=production`, `MUSIC_DB_PATH`, `MUSIC_DB_BACKUP_DIR`, `DEEPSEEK_API_KEY`, `NETEASE_USE_REAL_LOGIN=1`, `NETEASE_DEVICE_ID`, `AI_MUSIC_INVITE_CODES`, `TAGGING_WORKER_SECRET`, tagging queue limits, and sync limits.
- [ ] Keep `NETEASE_COOKIE` empty for normal production users unless it is intentionally used only as an owner bootstrap credential.
- [ ] Install dependencies on the server with the lockfile-compatible npm command.
- [ ] Run `npm run release:check` as the one-command pre-deploy gate when all production environment variables are present; the runner isolates test/typecheck under `NODE_ENV=test` before using production settings for deploy checks, build, and database checks.
- [ ] Follow `docs/deploy/private-server-runbook.md` for the ordered server procedure, including post-deploy smoke and rollback.
- [ ] Run `npm run deploy:check-env` and fix any missing production variables or unsafe settings before touching the database.
- [ ] Run `npm run db:check` against the server `MUSIC_DB_PATH`.
- [ ] Run `npm run db:backup` before first production start if an existing SQLite database is present.
- [ ] Run `npm run build` on the server or deploy a build artifact produced from the verified commit.
- [ ] Adapt `docs/deploy/ai-music.service` for the server app path, user, and environment file.
- [ ] Adapt `docs/deploy/nginx-ai-music.conf` for the deployed domain and TLS certificate paths.
- [ ] Start the app behind HTTPS so production session cookies can use `Secure`.
- [ ] Run `APP_BASE_URL=<server-origin> npm run smoke:production`.
- [ ] Trigger one worker pass with `APP_BASE_URL=<server-origin> TAGGING_WORKER_SECRET=<secret> npm run worker:tagging`.
- [ ] Adapt and enable `docs/deploy/ai-music-tagging-worker.service` plus `docs/deploy/ai-music-tagging-worker.timer` only after the manual worker pass succeeds.
- [ ] Browser-smoke `/` as a new user: QR appears, scan succeeds, sync is silent, playback becomes available when songs are ready.
- [ ] Browser-smoke `/` as an existing user: playback is available without admin/debug state.
- [ ] Browser-smoke expired Cookie: user is asked to scan again without exposing credential or queue internals.
- [ ] Browser-smoke `/admin` as owner: diagnostics, tag queue, profile health, and Cookie test tools render.
- [ ] Browser-smoke `/admin` as unknown/non-owner: page and admin APIs return 404.
- [ ] Confirm API responses and rendered pages do not contain raw Cookie markers: `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `encryptedCookie`, or `rawCookie`.
- [ ] Schedule the tagging worker with the chosen interval only after the manual worker pass succeeds.
- [ ] Record the deployment origin, database path, backup path, worker interval, and smoke result in this plan or `docs/deployment.md`.

---

## AI-Assisted Time Estimate

These estimates assume AI writes most code, with TDD and verification included.

- Finish current Phase 6 recommendation integration: 0.25 to 0.5 day.
- Finish Phase 6 refresh triggers and optional compaction: 0.5 to 1 day.
- Harden Phase 4 deployed identity/session and admin protection: 0.75 to 1.5 days.
- Cookie expiry validation and C-side re-login: 0.5 to 1 day.
- Phase 5 production queue worker/retry/cost controls: 0.5 to 1 day.
- Phase 7 companion bubble: 0.5 to 1 day.
- Phase 8 deployment hardening: 0.5 to 1 day.

**Fast private prototype from current state:** about 2 to 3 AI implementation days.

**Safer deployable version:** about 3.5 to 5.5 AI implementation days.

**Polished deployable version with profile and companion quality:** about 5 to 7 AI implementation days.

---

## Global Verification Gate

Before treating the full iteration as deployable, run:

```bash
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/app-shells.test.tsx
npm test -- tests/unit/cookie-test-page.test.tsx
npm run typecheck
npm run build
```

Manual route smoke checks:

```text
/
/admin
/admin/cookie-test
/api/login/diagnostics
/api/default-queue
/api/recommendations
/api/tags/queue
```

Manual product smoke checks:

- [ ] Pure new user opens `/`, scans QR, and reaches playback.
- [ ] Existing user opens `/` and directly reaches playback.
- [ ] Expired Cookie leads to re-login, not admin/debug exposure.
- [ ] `/admin` can inspect Cookie/tagging/profile health.
- [ ] User A and User B cannot see each other's private data.
- [ ] Public song tags are reused across users.
- [ ] Untagged songs still play.
- [ ] Proactive companion bubble triggers once and does not interrupt playback.
