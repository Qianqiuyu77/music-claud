# AI Music Full Iteration Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local single-owner AI music workbench into a deployable C/B separated product where normal users scan NetEase QR codes, listen immediately, get silent background sync/tagging, keep private user data isolated, and eventually receive lightweight profile-aware recommendations plus proactive AI companion messages.

**Architecture:** Keep `/` as the C-side listening product and `/admin` as the B-side operations product. Public song identity, metadata, and AI song tags are shared; user cookies, sources, playback, feedback, recommendation sessions, profiles, and companion state are private. Each phase must keep the app runnable and tested.

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite in current development, repository/service layers under `src/lib`, Vitest unit tests, route smoke checks, NetEase Cloud Music QR/Cookie flow, existing AI provider abstraction.

---

## Current Product Decisions

- C side is the normal user experience. It should not show Cookie details, sync counts, AI tagging internals, model traces, or admin diagnostics.
- B side is the owner/admin experience. It can show Cookie tools, sync diagnostics, tagging queues, data status, and operational actions.
- New users should enter through NetEase QR login on `/`.
- QR Cookie can expire, so login state must support validation and re-login.
- First sync should be silent. The user should not watch a technical progress panel.
- AI song tags are public song knowledge, not personal user profile data.
- User profile is useful, but it should support the algorithm rather than replace the existing recommendation pipeline.
- Deployment must not happen for real users until multi-user isolation is proven.

---

## Status Snapshot

- [x] Phase 1: B/C route and shell split.
- [x] Phase 2: QR Cookie persistence foundation.
- [x] Phase 3: C-side first-use onboarding and silent sync foundation.
- [~] Phase 4: multi-user data isolation foundation in progress.
- [ ] Phase 5: public base library reuse and background AI tagging queue.
- [ ] Phase 6: lightweight continuous user profile.
- [ ] Phase 7: proactive AI companion bubble.
- [ ] Phase 8: deployment hardening.

---

## Phase 1: B/C Split

**Goal:** Separate C-side and B-side ownership without changing the original UI/function behavior.

**Status:** Done.

**Implemented files:**

- `src/components/player/ConsumerMusicApp.tsx`
- `src/components/admin/AdminMusicApp.tsx`
- `src/app/page.tsx`
- `src/app/admin/page.tsx`
- `tests/unit/app-shells.test.tsx`

**Accepted behavior:**

- `/` enters the consumer shell.
- `/admin` enters the admin shell.
- Both currently reuse the existing workbench foundation.
- `/admin/cookie-test` remains the diagnostic Cookie acquisition tool.

**Regression checks:**

- [ ] Run `npm test -- tests/unit/app-shells.test.tsx`.
- [ ] Run route smoke for `/`, `/admin`, `/admin/cookie-test`.

---

## Phase 2: QR Cookie Persistence Foundation

**Goal:** Make QR login produce a backend-usable NetEase Cookie while never exposing the raw Cookie to UI/API consumers.

**Status:** Done as foundation.

**Implemented behavior:**

- QR authorized status can return raw Cookie internally.
- Service layer persists the credential.
- API response strips raw Cookie and returns only safe summaries.
- `/admin/cookie-test` can force QR testing even if backend already has a Cookie.

**Implemented files:**

- `src/lib/netease/cloudProvider.ts`
- `src/lib/netease/types.ts`
- `src/lib/appServices.ts`
- `src/components/admin/CookieTestPanel.tsx`
- `src/app/admin/cookie-test/page.tsx`
- `src/app/api/login/diagnostics/route.ts`
- `tests/unit/providers.test.ts`
- `tests/unit/api-contracts.test.ts`
- `tests/unit/cookie-test-page.test.tsx`

**Remaining work carried into Phase 4:**

- [ ] Store Cookie in user-scoped `user_login_states`.
- [ ] Validate Cookie before user sync.
- [ ] Mark expired Cookie and trigger C-side re-login.

---

## Phase 3: C-Side First-Use Onboarding And Silent Sync

**Goal:** A pure new user opens `/`, scans a QR code, then the app silently prepares songs without exposing admin state.

**Status:** Mostly done.

**Implemented behavior:**

- `ConsumerMusicApp` enables `silentSyncOnFirstUse`.
- C side shows a QR login entry when no usable Cookie exists.
- After QR authorization, C side transitions into a calm preparing state.
- Authorized empty library triggers `/api/sync` silently once.
- Sync success loads `/api/default-queue`.
- Existing library loads the default queue directly.
- Admin mode does not auto-sync.

**Key files:**

- `src/components/player/ConsumerMusicApp.tsx`
- `src/components/admin/AdminMusicApp.tsx`
- `src/components/workbench/Workbench.tsx`
- `tests/unit/workbench.test.tsx`

**Remaining tasks:**

- [ ] Add/verify expired Cookie consumer re-login state.
- [ ] Keep C-side copy calm and non-technical.
- [ ] Verify no Cookie summary/debug text appears on `/`.
- [ ] Route smoke `/` with no Cookie, valid Cookie, and empty library cases.

**Verification commands:**

- [ ] Run `npm test -- tests/unit/workbench.test.tsx tests/unit/app-shells.test.tsx tests/unit/cookie-test-page.test.tsx`.
- [ ] Run `npm run typecheck`.

---

## Phase 4: Multi-User Data Isolation

**Goal:** Make the app safe for several users on one deployed server.

**Core rule:** What a song is can be public. What a song means to a person must be private.

**Status:** In progress.

**Already implemented foundation:**

- Default owner user `id = 1`, `handle = "owner"`.
- `users.handle`.
- `user_login_states`.
- `user_song_sources`.
- `user_song_events`.
- `UserRepository`.
- `getDefaultCurrentUser`.
- User-scoped song source methods.
- User-scoped feedback/playback methods.
- User-scoped candidate song reads.
- Default owner compatibility in several app service methods.

**Current immediate fix:**

- [ ] In `tests/unit/api-contracts.test.ts`, replace old global seed calls with `repository.upsertCandidateSongsForUser(1, fixtureSongs)` or `repository.upsertCandidateSongsForUser(1, longFixtureSongs)` where owner-scoped reads are expected.
- [ ] Run `npm test -- tests/unit/api-contracts.test.ts -t "local library|default liked queue|continues recommendations|cooldown|playback|owner's private sources"`.

**Remaining isolation tasks:**

- [ ] Add `recommendation_sessions.user_id`.
- [ ] Add `RecommendationRepository.createSessionForUser(userId, input)`.
- [ ] Add `RecommendationRepository.getSessionWithItemsForUser(userId, sessionId)`.
- [ ] Keep old recommendation methods as owner-user compatibility wrappers during migration.
- [ ] Move QR/manual Cookie persistence from environment-style storage toward `user_login_states`.
- [ ] Add request-level current-user resolution.
- [ ] Add invite-code plus browser session as the first lightweight identity model.
- [ ] Ensure all private API reads/writes receive or resolve `userId`.
- [ ] Add tests proving user A cannot see user B Cookie, sources, playback, feedback, recommendation sessions, or profile.

**Acceptance criteria:**

- [ ] Two users can share one public song row.
- [ ] User A and user B can have different sources for the same song.
- [ ] User A feedback does not appear in user B recommendations.
- [ ] User A playback cooldown does not affect user B.
- [ ] Raw Cookie is never returned by API.
- [ ] Existing local owner data still works through user `1`.

**Verification commands:**

- [ ] Run `npm test -- tests/unit/repositories.test.ts`.
- [ ] Run `npm test -- tests/unit/api-contracts.test.ts`.
- [ ] Run `npm run typecheck`.

---

## Phase 5: Public Base Library Reuse And Background AI Tagging

**Goal:** Let new users benefit from already stored songs while keeping AI tagging in the background.

**Desired flow:**

```text
User syncs NetEase
-> app writes private user source rows
-> app reuses public songs by netease_song_id
-> app reuses public AI tags when present
-> app inserts missing public song metadata
-> app enqueues missing AI tag jobs
-> player can use songs immediately
```

**Tasks:**

- [ ] Add test: new user reuses existing public song metadata.
- [ ] Add test: public tags are reused across users.
- [ ] Add test: missing tags enqueue exactly one background job.
- [ ] Create tagging queue schema.
- [ ] Create `TaggingQueueRepository`.
- [ ] Update sync path to separate public song upsert from private user source insert.
- [ ] Add admin-visible queue processor or admin trigger.
- [ ] Let recommendation tolerate untagged songs with lower confidence.
- [ ] Keep C side unaware of tagging queue state.

**Candidate files:**

- `src/lib/db/schema.ts`
- `src/lib/repositories/musicRepository.ts`
- `src/lib/repositories/taggingQueueRepository.ts`
- `src/lib/tagging/taggingQueue.ts`
- `src/lib/appServices.ts`
- `tests/unit/repositories.test.ts`
- `tests/unit/song-tags.test.ts`
- `tests/unit/api-contracts.test.ts`

**Acceptance criteria:**

- [ ] Owner's tagged songs become a reusable public base library.
- [ ] A new user's first sync is faster when songs already exist.
- [ ] Untagged songs do not block playback.
- [ ] AI tagging never blocks first-use listening.

---

## Phase 6: Lightweight Continuous User Profile

**Goal:** Add private preference memory that improves recommendations over time without becoming a heavy personality system.

**Profile inputs:**

- Private user song sources.
- Public song tags.
- Private playback events.
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

**Tasks:**

- [ ] Add test: recommendations work when profile is missing.
- [ ] Add test: profile is built from one user's private data only.
- [ ] Add test: negative feedback changes the profile summary.
- [ ] Add `user_profiles` schema.
- [ ] Create `UserProfileRepository`.
- [ ] Create deterministic `userProfileBuilder` from tags/events/feedback.
- [ ] Optionally add AI compaction after deterministic profile assembly.
- [ ] Feed compact profile into recommendation context/ranking.
- [ ] Add stale-profile refresh rule after sync, feedback, or enough playback events.

**Candidate files:**

- `src/lib/db/schema.ts`
- `src/lib/repositories/userProfileRepository.ts`
- `src/lib/profile/userProfileBuilder.ts`
- `src/lib/appServices.ts`
- Recommendation pipeline files under `src/lib`
- `tests/unit/recommendation.test.ts`
- `tests/unit/api-contracts.test.ts`

**Acceptance criteria:**

- [ ] Profile is optional.
- [ ] Profile is private per user.
- [ ] Profile improves the existing algorithm instead of replacing song tags or scene parsing.

---

## Phase 7: Proactive AI Companion Bubble

**Goal:** Let AI say one short contextual sentence during playback without interrupting the user.

**Desired behavior:**

```text
Song is playing
-> playback reaches threshold
-> generate one short companion message
-> show small bubble near player/cover area
-> tap opens chat with the message
```

**Trigger rule:**

- Start with 30 seconds or 35% of song duration, whichever is later for short songs.
- Trigger once per song play.
- Do not auto-open chat.
- Do not pause playback.

**Tasks:**

- [ ] Add test: bubble does not appear before threshold.
- [ ] Add test: bubble appears once after threshold.
- [ ] Add test: bubble does not repeat for the same song play.
- [ ] Add test: tapping bubble opens chat.
- [ ] Add companion message service using current song, public tags, recent user profile summary, and current playback context.
- [ ] Add UI state tied to song id and playback progress.
- [ ] Add prompt constraints: short, contextual, no invented facts, no interruption.
- [ ] Ensure message generation is user-scoped after Phase 4.

**Candidate files:**

- `src/components/workbench/Workbench.tsx`
- Player/chat components under `src/components`
- `src/lib/appServices.ts`
- AI provider/prompt files under `src/lib`
- `tests/unit/workbench.test.tsx`
- `tests/unit/api-contracts.test.ts`

**Acceptance criteria:**

- [ ] AI feels present during playback.
- [ ] Player is never interrupted.
- [ ] Chat opens only when user taps.
- [ ] Bubble respects multi-user context.

---

## Phase 8: Deployment Hardening

**Goal:** Make the project deployable on a server without accidental data leakage or fragile local-only assumptions.

**Tasks:**

- [ ] Decide first deployment DB: keep SQLite with backups for private prototype, or move to Postgres if concurrency becomes important.
- [ ] Add production environment variable checklist.
- [ ] Add database backup/restore procedure.
- [ ] Add migration verification command.
- [ ] Protect `/admin` behind owner-only access.
- [ ] Add route smoke checks for `/`, `/admin`, `/admin/cookie-test`, login diagnostics, sync, default queue.
- [ ] Add build gate with `npm run build`.
- [ ] Confirm raw Cookie never appears in logs, UI, or API JSON.

**Acceptance criteria:**

- [ ] Server can host more than one user safely.
- [ ] Admin features are not available to normal C-side users.
- [ ] Cookie expiry/re-login works.
- [ ] Backup/migration path is documented.

---

## Recommended Execution Order From Here

1. Finish Phase 4 test repair and owner-scoped API compatibility.
2. Finish Phase 4 recommendation session isolation.
3. Move login state into user-scoped storage.
4. Add current-user resolution with invite-code/browser session.
5. Implement Phase 5 base library reuse and background tagging.
6. Implement Phase 6 lightweight profile.
7. Implement Phase 7 companion bubble.
8. Run Phase 8 deployment hardening.

---

## AI-Assisted Time Estimate

These are engineering-time estimates for AI writing most of the code, with tests and verification included.

- Finish current Phase 4 slice: 0.5 day.
- Complete deployable Phase 4 identity/data isolation: 1 to 1.5 days.
- Phase 5 base library and tag queue: 0.75 to 1.5 days.
- Phase 6 lightweight profile: 0.75 to 1.5 days.
- Phase 7 companion bubble: 0.5 to 1 day.
- Phase 8 deployment hardening: 0.5 to 1 day.

**Fast private prototype:** about 2 to 3 days from current state.

**Safer deployable version:** about 4 to 6 days from current state.

**Polished version with profile and companion quality:** about 5 to 7 days from current state.

---

## Global Verification Gate

Before treating the iteration as deployable, run:

```bash
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx tests/unit/app-shells.test.tsx tests/unit/cookie-test-page.test.tsx
npm run typecheck
npm run build
```

Then run route smoke checks for:

```text
/
/admin
/admin/cookie-test
/api/login/diagnostics
/api/default-queue
```
