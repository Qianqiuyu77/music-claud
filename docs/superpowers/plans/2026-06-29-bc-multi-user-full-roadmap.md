# B/C Multi-User Product Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the full roadmap from B/C separation through multi-user deployment, public library reuse, background AI tagging, user profiles, and proactive companion bubbles.

**Architecture:** Implement the roadmap as staged, independently verifiable sub-projects. Phase 1 establishes zero-behavior-change route and code boundaries; later phases add QR persistence, consumer onboarding, multi-user data isolation, public song knowledge reuse, background tagging, user-private profiles, and proactive companion behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, SQLite now with a possible Postgres migration decision later, Vitest, Playwright, NetEase Cloud Music API wrapper, DeepSeek/OpenAI-compatible AI provider.

---

## Roadmap Scope

This roadmap covers the full design in:

```text
docs/superpowers/specs/2026-06-29-bc-split-multi-user-onboarding-design.md
```

The roadmap is intentionally split into executable phase plans. Do not implement all phases in one code branch unless the user explicitly asks for a large integrated branch. Each phase should leave the app runnable and tested.

---

## Phase Overview

```text
Phase 1: B/C shell split with zero behavior change
Phase 2: QR Cookie persistence and expiry handling
Phase 3: C-side first-use onboarding and silent sync
Phase 4: server deployment and multi-user data isolation
Phase 5: public base library reuse and background AI tag queue
Phase 6: lightweight continuous user profile
Phase 7: AI companion proactive bubble
```

Recommended execution order:

```text
1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7
```

Reasoning:

- Phase 1 creates safe B/C boundaries without changing UI.
- Phase 2 makes QR login real enough for onboarding.
- Phase 3 can then change the C side user flow without touching admin behavior.
- Phase 4 prevents private user data leakage before sharing with friends.
- Phase 5 improves scalability and first-use speed.
- Phase 6 and Phase 7 are experience intelligence layers that depend on clean user data boundaries.

---

## Phase 1: B/C Shell Split With Zero Behavior Change

**Goal:** Separate C-side and B-side route ownership in code without changing current UI, copy, behavior, API timing, database schema, or feature availability.

**Dedicated phase plan:**

```text
docs/superpowers/plans/2026-06-29-bc-shell-split-zero-behavior-change.md
```

**Primary files:**

- Create `src/components/player/ConsumerMusicApp.tsx`
- Create `src/components/admin/AdminMusicApp.tsx`
- Modify `src/app/page.tsx`
- Modify `src/app/admin/page.tsx`
- Create `tests/unit/app-shells.test.tsx`

**Behavior contract:**

- `/` still renders the current player workbench experience.
- `/admin` still renders the current admin workbench experience.
- `/admin/cookie-test` remains available and unchanged.
- No CSS or user-facing copy changes.

**Exit criteria:**

- Shell tests pass.
- Existing workbench tests pass.
- Cookie test page tests pass.
- `npm run typecheck` passes.
- Smoke requests to `/`, `/admin`, and `/admin/cookie-test` return `200`.

---

## Phase 2: QR Cookie Persistence and Expiry Handling

**Goal:** Convert QR login from a diagnostic proof into a usable login path.

**Create a dedicated implementation plan before coding:**

```text
docs/superpowers/plans/YYYY-MM-DD-qr-cookie-persistence-expiry.md
```

**Primary files likely touched:**

- `src/lib/netease/cloudProvider.ts`
- `src/lib/appServices.ts`
- `src/app/api/login/qr/route.ts`
- `src/app/api/login/status/route.ts`
- `src/app/api/login/cookie/route.ts`
- `src/app/api/login/diagnostics/route.ts`
- `src/components/admin/CookieTestPanel.tsx`
- `tests/unit/providers.test.ts`
- `tests/unit/api-contracts.test.ts`
- `tests/unit/cookie-test-page.test.tsx`

**Required behavior:**

```text
QR authorized
-> backend has access to raw NetEase Cookie
-> normalize Cookie
-> validate with /user/account
-> persist as current login state
-> diagnostics show configured and valid
```

**Single-user interim storage:**

- Existing `.env.local` write path can remain for now.
- The saved Cookie must not be printed to logs or shown by default.

**Future multi-user storage compatibility:**

- Service names and return shapes should not hard-code `.env.local` as the only possible store.
- Prefer service APIs such as `saveNeteaseLoginState(cookie)` over UI code calling env writers directly.

**Expiry behavior:**

```text
startup or login diagnostics
-> validate Cookie with /user/account
-> if invalid, return expired/invalid state
-> C side can later ask user to scan again
```

**Tests required:**

- Provider returns raw or persistable QR Cookie when NetEase returns code `803`.
- QR status endpoint persists valid Cookie in single-user mode.
- Invalid QR Cookie is rejected and not persisted.
- Diagnostics reports invalid/expired when `/user/account` fails.
- Existing manual Cookie save still works.

**Exit criteria:**

- A QR scan can replace manual Cookie input for single-user local mode.
- Diagnostics confirms the saved QR Cookie is valid.
- Existing manual Cookie path still works.

---

## Phase 3: C-Side First-Use Onboarding and Silent Sync

**Goal:** Make first use on `/` consumer-friendly while keeping admin/debug state in `/admin`.

**Create a dedicated implementation plan before coding:**

```text
docs/superpowers/plans/YYYY-MM-DD-consumer-first-use-silent-sync.md
```

**Depends on:**

- Phase 1 route/code split.
- Phase 2 QR Cookie persistence.

**Primary files likely touched:**

- `src/components/player/ConsumerMusicApp.tsx`
- new `src/components/player/ConsumerOnboarding.tsx`
- new `src/components/player/ConsumerBootstrap.tsx`
- `src/components/workbench/Workbench.tsx` only if needed as compatibility layer
- `src/app/api/login/diagnostics/route.ts`
- `src/app/api/sync/route.ts`
- `src/app/api/default-queue/route.ts`
- `src/lib/appServices.ts`
- new or updated tests in `tests/unit/consumer-onboarding.test.tsx`

**C-side state machine:**

```text
checking_login
-> needs_login
-> qr_pending
-> preparing_library
-> ready
-> login_expired
```

**User-visible states only:**

- Preparing first songs.
- Ready to listen.
- Login expired, scan again.

**Do not show on C side:**

- AI tagging counts.
- Raw sync failure list.
- Model traces.
- Cookie value.
- Admin controls.

**Silent sync behavior:**

```text
valid login but no usable queue
-> trigger first sync quietly
-> load default queue once enough songs exist
-> keep player usable as soon as queue exists
```

**Fallback behavior:**

- If sync fails because Cookie expired, show re-login state.
- If sync partially fails but enough songs exist, enter player.
- If no songs can be prepared, show a simple retry/re-login affordance without debug detail.

**Tests required:**

- No login and no library renders consumer login state.
- Valid login and existing library renders player.
- Valid login and empty library triggers silent sync then default queue.
- Admin controls do not appear in C onboarding.
- Existing `/admin` behavior remains unchanged.

**Exit criteria:**

- A new local user can scan, wait briefly, and reach playable content without visiting `/admin`.
- The C side does not expose engineering details.

---

## Phase 4: Server Deployment and Multi-User Data Isolation

**Goal:** Support a small group of users without data leakage.

**Create a dedicated implementation plan before coding:**

```text
docs/superpowers/plans/YYYY-MM-DD-multi-user-data-isolation.md
```

**Depends on:**

- Phase 1 boundary split.
- Phase 2 login persistence service abstraction.
- Preferably Phase 3 consumer onboarding.

**Primary files likely touched:**

- `src/lib/db/schema.ts`
- `src/lib/db/types.ts`
- `src/lib/db/client.ts`
- `src/lib/repositories/musicRepository.ts`
- `src/lib/repositories/recommendationRepository.ts`
- `src/lib/appServices.ts`
- login API routes under `src/app/api/login/**`
- recommendation, feedback, play-event, sync routes
- tests under `tests/unit/repositories.test.ts`
- tests under `tests/unit/api-contracts.test.ts`

**Data model target:**

Public data:

```text
songs
song_ai_profiles or song_tags
playback_cache
artist / album metadata as needed
```

Private user data:

```text
users
user_login_states
user_song_sources
user_song_events
user_profiles
user_recommendation_sessions
user_recommendation_items
```

**Isolation rules:**

- Every user-private query must include `user_id`.
- Public song rows can be shared by all users.
- Public AI tags can be shared by all users.
- Feedback, playback, sources, recommendation sessions, and login credentials must never be shared.

**Migration requirements:**

- Existing owner library can become public base song data.
- Existing owner `sources_json` should migrate to owner `user_song_sources`.
- Existing `song_events` should migrate to owner `user_song_events`.
- Existing recommendation history should migrate to owner recommendation tables or be archived if migration is too risky.

**App-level user identity open decision:**

Choose one before implementation:

```text
Option A: invite code + local user session
Option B: simple account login
Option C: first-session local identity for private server use
```

Recommended for small friends deployment:

```text
Option A: invite code + local user session
```

**Tests required:**

- User A and User B can share the same public song row.
- User A feedback does not appear in User B recommendations.
- User A login Cookie cannot be read by User B.
- Recommendation sessions are filtered by user.
- Sync imports create user sources, not public source flags.

**Exit criteria:**

- The app can support at least two users in tests with no cross-user private data leakage.

---

## Phase 5: Public Base Library Reuse and Background AI Tag Queue

**Goal:** Reuse public song knowledge and avoid blocking playback on AI tagging.

**Create a dedicated implementation plan before coding:**

```text
docs/superpowers/plans/YYYY-MM-DD-public-library-background-tagging.md
```

**Depends on:**

- Phase 4 public/private data split.

**Primary files likely touched:**

- `src/lib/repositories/musicRepository.ts`
- new `src/lib/repositories/taggingQueueRepository.ts`
- new `src/lib/tagging/taggingQueue.ts`
- `src/lib/appServices.ts`
- sync/expand/tag API routes
- recommendation engine inputs
- tests under `tests/unit/song-tags.test.ts`
- tests under `tests/unit/repositories.test.ts`
- tests under `tests/unit/api-contracts.test.ts`

**Required behavior:**

```text
new user syncs a song
-> if public song exists, reuse metadata/tags
-> if public song missing, insert metadata
-> if tags missing, enqueue background tag job
-> recommendation can use song immediately with lower confidence
```

**Queue priority:**

1. liked songs
2. recently played songs
3. high-frequency playlist songs
4. recommendation candidates
5. other public songs missing tags

**Do not block:**

- first playback
- default queue
- recommendation request
- C-side navigation

**Admin visibility:**

- B side may show queue status later.
- C side must not show queue internals.

**Tests required:**

- Existing public tags are reused for a new user's song.
- Missing tags enqueue work.
- Untagged songs participate with lower confidence.
- Tag jobs are idempotent per `netease_song_id`.

**Exit criteria:**

- New users benefit from the owner's existing tagged library.
- AI tagging can run in background without blocking user playback.

---

## Phase 6: Lightweight Continuous User Profile

**Goal:** Add user-private preference memory to the recommendation pipeline.

**Create a dedicated implementation plan before coding:**

```text
docs/superpowers/plans/YYYY-MM-DD-lightweight-user-profile.md
```

**Depends on:**

- Phase 4 user-private data isolation.
- Phase 5 public song tags are helpful but not strictly required.

**Primary files likely touched:**

- `src/lib/db/schema.ts`
- `src/lib/repositories/userProfileRepository.ts`
- new `src/lib/profile/userProfileBuilder.ts`
- `src/lib/appServices.ts`
- `src/lib/ai/deepseekProvider.ts`
- recommendation API route
- tests under `tests/unit/recommendation.test.ts`
- tests under `tests/unit/api-contracts.test.ts`

**Profile inputs:**

- user song sources
- public song tags
- playback events
- explicit feedback
- too familiar/dislike signals
- recent behavior window

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

- after meaningful sync
- after enough playback events
- after explicit feedback
- before recommendation if profile is stale

**Recommendation integration:**

```text
scene intent + song profile + user profile
-> local ranking
-> AI rerank
```

The profile must support the current algorithm, not replace it.

**Tests required:**

- Empty user profile does not block recommendations.
- User profile summary is built from only that user's data.
- Negative feedback affects profile output.
- User A profile never includes User B data.

**Exit criteria:**

- Recommendations can use a compact user-private preference summary.
- Profile absence remains a supported state.

---

## Phase 7: AI Companion Proactive Bubble

**Goal:** Let the AI companion make one short, non-interrupting comment during playback.

**Create a dedicated implementation plan before coding:**

```text
docs/superpowers/plans/YYYY-MM-DD-proactive-companion-bubble.md
```

**Depends on:**

- Existing chat endpoint.
- Stable player state.
- User data isolation if multi-user branch is already active.

**Primary files likely touched:**

- `src/components/workbench/RecommendationPanel.tsx` or migrated player component
- `src/lib/companionChatRoute.ts`
- `src/lib/appServices.ts`
- `src/lib/ai/types.ts`
- `src/lib/ai/deepseekProvider.ts`
- `tests/unit/workbench.test.tsx`
- `tests/unit/api-contracts.test.ts`

**Trigger behavior:**

```text
song is playing
-> current time reaches 30 seconds or chosen percentage
-> each song triggers once
-> request one short companion message
-> show as cover bubble
-> tapping bubble opens chat with that message in history
```

**Constraints:**

- No auto-open chat.
- No playback interruption.
- No repeated comments for the same song play.
- No invented song facts.
- Reuse current song and lyric context when available.

**Tests required:**

- Bubble triggers at threshold.
- Bubble does not trigger before threshold.
- Bubble triggers once per song.
- Tapping bubble opens chat.
- Chat history includes proactive message.

**Exit criteria:**

- The companion can speak proactively without disrupting listening.

---

## Cross-Phase Rules

- Preserve C-side calmness. Do not expose admin/debug details on `/`.
- Keep B-side observability. Admin pages may expose detailed diagnostics.
- Do not log raw Cookies.
- Do not show raw Cookies by default.
- Do not block playback on AI tagging.
- Do not mix user-private data into public song rows.
- Keep each phase deployable and testable.

---

## Full Verification Gate

Before declaring the full roadmap complete, run:

```bash
npm run typecheck
npm test
npm run build
```

Run Playwright smoke tests after the app can build:

```bash
npm run test:e2e
```

Manual smoke checklist:

- New user can open `/`, scan, and reach playback.
- Existing user can open `/` and continue listening.
- Admin can open `/admin`.
- Cookie test page remains available under `/admin/cookie-test`.
- Two test users do not share private playback, feedback, Cookie, profile, or recommendation sessions.
- Public song tags are reused across users.
- Untagged songs still play and can be recommended with lower confidence.
- Cookie expiry forces re-login without losing public library data.
- Proactive companion bubble does not interrupt playback.

---

## Roadmap Completion Definition

The roadmap is complete when:

- C and B sides have clear route and code ownership.
- QR login can persist usable NetEase credentials.
- Cookie expiry is detected and recoverable.
- New users can reach playback without visiting admin tools.
- Multi-user private data is isolated by tests.
- Public song knowledge is reused across users.
- AI tagging runs in the background and does not block playback.
- User profiles are private and optional.
- AI proactive companion messages work without interrupting playback.

---

## Planning Notes

The detailed implementation plan already exists for Phase 1:

```text
docs/superpowers/plans/2026-06-29-bc-shell-split-zero-behavior-change.md
```

Before implementing each later phase, create its dedicated plan using `superpowers:writing-plans`. Later phase plans must include exact test code, exact file paths, red-green steps, verification commands, and commit checkpoints.
