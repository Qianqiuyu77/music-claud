# AI Music Full Iteration Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current single-user local music workbench into a deployable C/B separated music product with QR login, silent first-use sync, user-private data isolation, shared public song knowledge, background AI tagging, lightweight user profile, and proactive AI companion messages.

**Architecture:** Keep `/` as the C-side listening entry and `/admin` as the B-side operations entry. Public song metadata and AI tags are shared across users, while cookies, sources, playback events, feedback, profiles, and recommendation history are private per user. Each phase must leave the app runnable and testable.

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite for current local development, repository/service layers under `src/lib`, Vitest unit tests, Playwright or route smoke checks where useful, NetEase Cloud Music API integration, existing AI provider abstraction.

---

## Current Status

- [x] Phase 1: B/C shell split with zero behavior change.
- [x] Phase 2: QR Cookie persistence foundation.
- [ ] Phase 3: C-side first-use onboarding and silent sync.
- [ ] Phase 4: server deployment and multi-user data isolation.
- [ ] Phase 5: public base library reuse and background AI tagging.
- [ ] Phase 6: lightweight continuous user profile.
- [ ] Phase 7: proactive AI companion bubble.

---

## Product Principles

- C side is for listening. It should not show sync counts, model traces, Cookie details, AI tagging progress, or admin diagnostics.
- B side is for operations. It can show diagnostics, sync status, Cookie health, tagging queues, and data tools.
- QR login is the normal first-use path for C-side users.
- Cookie is sensitive and can expire. The app must store it privately, validate it, and ask the user to scan again when needed.
- AI tagging is public song knowledge and should not be mixed with personal user profile data.
- User profile is private and should support the algorithm, not replace it.
- First-use sync should be silent and should not block the app longer than necessary.
- A deployable version must not leak one user's Cookie, feedback, listening events, profile, or recommendation sessions to another user.

---

## Phase 1: B/C Shell Split

**Status:** Done.

**Purpose:** Establish route and component ownership without changing UI or behavior.

**Implemented shape:**

- `/` renders `src/components/player/ConsumerMusicApp.tsx`.
- `/admin` renders `src/components/admin/AdminMusicApp.tsx`.
- Both currently reuse `src/components/workbench/Workbench.tsx`.
- `/admin/cookie-test` remains the Cookie acquisition test surface.

**Verification:**

- `npm run typecheck`
- `npm test -- tests/unit/app-shells.test.tsx tests/unit/workbench.test.tsx tests/unit/cookie-test-page.test.tsx`
- Route smoke checks for `/`, `/admin`, `/admin/cookie-test`.

---

## Phase 2: QR Cookie Persistence

**Status:** Done as foundation.

**Purpose:** Make QR login persist a usable backend Cookie instead of only returning a diagnostic summary.

**Implemented shape:**

- NetEase QR status can return a raw Cookie internally on authorized status.
- Service layer persists the raw Cookie and strips it from API responses.
- API consumers receive safe encrypted summaries only.
- Cookie test page can still force QR flow for diagnostics.

**Remaining follow-up in later phases:**

- Move from single-user local persistence to user-scoped login state.
- Validate expiry per user before sync.
- Keep raw Cookie out of UI, logs, and public responses.

**Verification:**

- `npm test -- tests/unit/providers.test.ts -t "QR login"`
- `npm test -- tests/unit/api-contracts.test.ts -t "login|Cookie|cookie|QR"`
- `npm test -- tests/unit/cookie-test-page.test.tsx`
- `npm run typecheck`

---

## Phase 3: C-Side First-Use Onboarding And Silent Sync

**Recommended estimate:** 0.5 to 1 AI implementation day.

**Purpose:** Let a pure new user open `/`, scan a NetEase QR code, then quietly prepare playable songs without exposing admin state.

**User flow:**

```text
Open /
-> check login state
-> if no valid Cookie, show QR login
-> user scans and confirms
-> backend persists Cookie
-> app silently checks library
-> if library is empty, app calls sync in background
-> once usable songs exist, app loads default queue
-> user enters the player
```

**C-side visible states:**

- Scan to connect NetEase.
- Preparing your first songs.
- Ready to listen.
- Login expired, scan again.

**C-side hidden details:**

- Raw Cookie.
- Encrypted Cookie summary.
- Sync counts.
- Partial failure details.
- AI tagging queue state.
- Admin data panels.

**Primary files:**

- Modify `src/components/player/ConsumerMusicApp.tsx`.
- Modify `src/components/workbench/Workbench.tsx` only as a compatibility layer.
- Possibly create `src/components/player/ConsumerOnboarding.tsx`.
- Possibly create `src/components/player/useConsumerBootstrap.ts`.
- Modify or reuse `src/app/api/login/diagnostics/route.ts`.
- Reuse `src/app/api/sync/route.ts`.
- Reuse `src/app/api/default-queue/route.ts`.
- Test `tests/unit/workbench.test.tsx`.
- Test new `tests/unit/consumer-onboarding.test.tsx` if the logic is split.

**Implementation tasks:**

- [ ] Add a failing test for consumer empty-library + valid-login auto sync.
- [ ] Add a failing test that admin mode does not auto sync.
- [ ] Add a failing test that consumer side does not show admin controls or sync details.
- [ ] Add a consumer bootstrap flag or hook that is enabled only from `ConsumerMusicApp`.
- [ ] When login is authorized and library has zero songs, call `/api/sync` once silently.
- [ ] After sync succeeds with usable songs, call `/api/default-queue`.
- [ ] If login is expired or QR fails, show a calm re-login state.
- [ ] Run focused tests and typecheck.

**Acceptance criteria:**

- A new user can start from `/` without visiting `/admin`.
- The app can silently sync after QR login.
- The C side stays clean and does not show engineering details.
- Admin behavior remains unchanged.

---

## Phase 4: Server Deployment And Multi-User Data Isolation

**Recommended estimate:** 1.5 to 3 AI implementation days, depending on migration complexity.

**Purpose:** Make the app safe for a small group of users on one deployed server.

**Core data rule:**

```text
What a song is = public.
What a song means to one user = private.
```

**Public data:**

- songs
- albums/artists if normalized
- public song metadata
- public AI tags or song AI profiles
- shared playback/cache metadata if needed

**Private user data:**

- users
- user login states
- user song sources
- user song events
- feedback
- recommendation sessions
- recommendation items
- user profiles

**Identity decision:**

Recommended first version:

```text
Invite code + local browser session
```

This is lighter than a full account system and enough for a private friend deployment.

**Primary files:**

- Modify `src/lib/db/schema.ts`.
- Modify `src/lib/db/client.ts`.
- Modify repository files under `src/lib/repositories/`.
- Modify service orchestration in `src/lib/appServices.ts`.
- Modify API routes that read/write private user data.
- Add migration scripts under the existing migration location if present.
- Test repository isolation in `tests/unit/repositories.test.ts`.
- Test API isolation in `tests/unit/api-contracts.test.ts`.

**Implementation tasks:**

- [ ] Add schema tests for public song rows and private user rows.
- [ ] Add repository tests proving User A and User B can share one song but not private data.
- [ ] Add `users` and `user_login_states`.
- [ ] Split current song source data into `user_song_sources`.
- [ ] Split playback events into `user_song_events`.
- [ ] Scope feedback and recommendation sessions by `user_id`.
- [ ] Add request-level current-user resolution.
- [ ] Update services so every private query receives `user_id`.
- [ ] Migrate existing local owner data into one default owner user.
- [ ] Run full repository and API tests.

**Acceptance criteria:**

- Two users can exist in tests.
- They can share public song metadata and AI tags.
- They cannot see each other's Cookie, playback, feedback, profile, or recommendation history.
- Existing local owner data still works after migration.

---

## Phase 5: Public Base Library Reuse And Background AI Tagging

**Recommended estimate:** 1 to 2 AI implementation days.

**Purpose:** Let new users benefit from already stored songs and AI tags while keeping AI tagging non-blocking.

**Sync behavior:**

```text
User syncs NetEase library
-> match by netease_song_id
-> reuse public song if it exists
-> reuse public AI tags if they exist
-> create missing public song metadata
-> enqueue missing AI tag jobs
-> player can use songs immediately
```

**Queue priority:**

1. Liked songs.
2. Recently played songs.
3. High-frequency playlist songs.
4. Recommendation candidates.
5. Other missing-tag songs.

**Primary files:**

- Modify `src/lib/repositories/musicRepository.ts`.
- Create `src/lib/repositories/taggingQueueRepository.ts`.
- Create `src/lib/tagging/taggingQueue.ts`.
- Modify `src/lib/appServices.ts`.
- Modify AI tagging service files if already present.
- Add tests under `tests/unit/song-tags.test.ts`.
- Add repository tests under `tests/unit/repositories.test.ts`.

**Implementation tasks:**

- [ ] Add failing test: new user reuses an existing public song row.
- [ ] Add failing test: public tags are reused across users.
- [ ] Add failing test: missing tags enqueue exactly one job per song.
- [ ] Add queue table or queue repository.
- [ ] Update sync to create user source rows separately from public song rows.
- [ ] Update recommendation input to tolerate missing tags.
- [ ] Add background tagging worker entry point or admin-triggered queue processor.
- [ ] Run focused tests and typecheck.

**Acceptance criteria:**

- Owner's already-tagged songs become a public base library.
- A new user's first sync is faster when songs already exist.
- Untagged songs can still play and participate in recommendations with lower confidence.
- AI tagging never blocks first playback.

---

## Phase 6: Lightweight Continuous User Profile

**Recommended estimate:** 1 to 2 AI implementation days.

**Purpose:** Add private preference memory so recommendations can become more personal over time.

**Profile inputs:**

- User song sources.
- Public song tags.
- Playback events.
- Explicit feedback.
- Too-familiar signals.
- Dislike signals.
- Recent listening window.

**Profile output:**

```text
user_profiles
- user_id
- profile_json
- compact_summary
- confidence
- last_refreshed_at
```

**Refresh triggers:**

- After meaningful sync.
- After enough playback events.
- After explicit feedback.
- Before recommendation if stale.

**Primary files:**

- Modify `src/lib/db/schema.ts`.
- Create `src/lib/repositories/userProfileRepository.ts`.
- Create `src/lib/profile/userProfileBuilder.ts`.
- Modify `src/lib/appServices.ts`.
- Modify recommendation pipeline files.
- Test `tests/unit/recommendation.test.ts`.
- Test `tests/unit/api-contracts.test.ts`.

**Implementation tasks:**

- [ ] Add failing test: empty profile does not block recommendations.
- [ ] Add failing test: profile is built from one user's private data only.
- [ ] Add failing test: negative feedback changes the profile summary.
- [ ] Add `user_profiles` schema and repository.
- [ ] Build deterministic local profile summary from tags/events/feedback.
- [ ] Add optional AI compaction only after deterministic data is assembled.
- [ ] Feed compact profile into recommendation ranking/reranking.
- [ ] Run focused tests and typecheck.

**Acceptance criteria:**

- Recommendations work with or without a profile.
- Profile data is private per user.
- The profile helps the existing algorithm; it does not replace song tags or scene intent.

---

## Phase 7: Proactive AI Companion Bubble

**Recommended estimate:** 0.5 to 1.5 AI implementation days.

**Purpose:** Let the AI say one short contextual sentence during playback without interrupting listening.

**Behavior:**

```text
Song is playing
-> playback reaches threshold
-> generate one short companion message
-> show a small bubble on the cover/player area
-> tapping it opens chat with that message in history
```

**Trigger rule:**

- Start with 30 seconds or 35% of song duration, whichever is later for short songs.
- Trigger once per song play.
- Do not auto-open chat.
- Do not pause playback.

**Primary files:**

- Modify player or recommendation panel component that owns playback state.
- Modify companion/chat service route if needed.
- Modify `src/lib/appServices.ts`.
- Modify AI provider prompt types if needed.
- Test `tests/unit/workbench.test.tsx`.
- Test `tests/unit/api-contracts.test.ts`.

**Implementation tasks:**

- [ ] Add failing test: bubble does not appear before threshold.
- [ ] Add failing test: bubble appears once after threshold.
- [ ] Add failing test: bubble does not repeat for the same song play.
- [ ] Add failing test: tapping bubble opens chat.
- [ ] Add a proactive companion request service.
- [ ] Add UI bubble state tied to current song and playback progress.
- [ ] Add prompt constraints: short, contextual, no invented facts.
- [ ] Run focused tests and typecheck.

**Acceptance criteria:**

- AI feels present during playback.
- The player is never interrupted.
- Chat opens only when the user chooses to tap.
- The feature respects multi-user context if Phase 4 has landed.

---

## Recommended Execution Order

1. Finish Phase 3 first because it completes the new-user C-side experience using the QR foundation already built.
2. Do Phase 4 before inviting real users, because data isolation must exist before deployment.
3. Do Phase 5 after isolation, because public base library reuse depends on separating public songs from private user sources.
4. Do Phase 6 after private user data exists, because the profile must be user-scoped.
5. Do Phase 7 last, because it depends on stable playback state and benefits from profile/context.

---

## Time Estimate

For AI-assisted implementation with review and tests:

- Phase 3: 0.5 to 1 day.
- Phase 4: 1.5 to 3 days.
- Phase 5: 1 to 2 days.
- Phase 6: 1 to 2 days.
- Phase 7: 0.5 to 1.5 days.

Total remaining estimate:

```text
4.5 to 9.5 AI implementation days
```

Fast path for a private prototype:

```text
Phase 3 + minimal Phase 4 + minimal Phase 5 = about 3 to 5 days
```

Polished deployable path:

```text
All remaining phases with tests and migration safety = about 6 to 10 days
```

---

## Full Acceptance Checklist

- [ ] New user can open `/` and scan QR.
- [ ] QR Cookie is saved without exposing raw Cookie.
- [ ] Expired Cookie leads to re-login.
- [ ] First sync runs silently on C side.
- [ ] Player becomes usable as soon as a default queue exists.
- [ ] `/admin` keeps diagnostics and operational controls.
- [ ] Two users cannot access each other's private data.
- [ ] Public song metadata and AI tags are shared.
- [ ] Missing AI tags are queued in the background.
- [ ] Untagged songs do not block playback.
- [ ] User profile is private and optional.
- [ ] Recommendation works without profile and improves with profile.
- [ ] Proactive companion bubble triggers once and does not interrupt playback.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes before deployment.

---

## Deployment Gate

Do not deploy to real users until these are true:

- Multi-user identity exists.
- Cookie storage is user-scoped.
- Private data queries require `user_id`.
- Raw Cookie is never returned by API.
- Admin routes are not confused with C-side routes.
- Database backup and migration path are clear.
- Environment secrets are configured on the server.
- Route smoke checks pass for `/`, `/admin`, and QR login flow.
