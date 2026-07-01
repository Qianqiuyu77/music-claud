# B/C Split, Multi-User Onboarding, and Data Isolation Design

## Purpose

Evolve the project from a single-user local music workbench into a deployable product that can serve a small group of users while preserving the current listening experience.

The long-term product shape is:

- C side: normal users listen to music, scan NetEase login QR codes, and get usable recommendations without seeing engineering state.
- B side: the owner manages cookies, syncs, public library data, AI tagging, recommendation traces, and diagnostics.
- Server side: public song knowledge is shared, while each user's login state, sources, playback, feedback, profile, and recommendation history are isolated.

## Current State

The current app has useful functionality, but the boundaries are mixed:

- `/` and `/admin` both use the same `Workbench` component with a mode flag.
- `/admin/cookie-test` exists as a test/debug surface for NetEase Cookie acquisition.
- Song metadata, AI tags, user sources, playback counts, and feedback are currently mixed in one local database model.
- QR login can obtain a NetEase login credential, but QR credential persistence is not wired into the normal login state.
- New users would currently see an empty or admin-like workflow instead of a guided consumer onboarding experience.

## Design Principles

- The C side should stay usable and calm. Users should not see sync counts, tagging progress, model calls, or debug details.
- The B side should keep full operational visibility for the owner.
- The first implementation phase must not change current UI, text, flows, or behavior. It only establishes code and route boundaries.
- Public song knowledge and private user meaning must be separated.
- First-use setup must be progressive: users should be able to listen as soon as a small usable queue exists.
- AI tagging must never block basic playback.
- Cookie credentials are sensitive and may expire; the app must support re-login.

## Phase 1: B/C Code and Route Split With Zero Behavior Change

Goal: create clear code ownership boundaries without changing UI or functionality.

Routes:

- `/`: C-side entry.
- `/admin`: B-side admin entry.
- `/admin/cookie-test`: B-side Cookie acquisition test tool.

Proposed code shape:

```text
src/app/page.tsx
-> components/player/ConsumerMusicApp.tsx

src/app/admin/page.tsx
-> components/admin/AdminMusicApp.tsx

src/app/admin/cookie-test/page.tsx
-> components/admin/CookieTestPanel.tsx
```

Initial implementation can keep `Workbench` as a compatibility layer:

```text
ConsumerMusicApp -> <Workbench mode="player" />
AdminMusicApp -> <Workbench mode="admin" />
```

Non-goals for Phase 1:

- Do not change UI.
- Do not change copy.
- Do not change login behavior.
- Do not change sync behavior.
- Do not change recommendation behavior.
- Do not change database schema.

Success criteria:

- `/` renders the same user experience as before.
- `/admin` renders the same admin experience as before.
- Existing tests continue to pass.
- New route/component boundary tests cover the app shells.

## Phase 2: C-Side First-Use Onboarding

Goal: make the first user experience consumer-friendly after the Phase 1 boundary exists.

Target flow:

```text
User opens /
-> If active login and usable local library exist: enter player.
-> If no active login: show NetEase QR login.
-> User scans and confirms.
-> Backend saves Cookie.
-> Backend validates /user/account.
-> App quietly prepares first usable songs.
-> Player opens as soon as a small playable queue exists.
```

The C side should only expose user-relevant states:

- Preparing first songs.
- Ready to listen.
- Login expired, scan again.

The C side should not expose:

- Number of synced playlists.
- AI tagging progress.
- Model traces.
- Partial failure internals.
- Raw Cookie state.

## Phase 3: QR Cookie Persistence and Expiry Handling

Goal: make QR login a real login path, not only a diagnostic proof.

Current QR status returns an encrypted local credential summary. The next step is:

```text
QR authorized
-> backend receives raw NetEase Cookie from provider
-> normalize Cookie
-> validate account
-> persist login state
-> refresh app login status
```

Single-user storage can continue to write `.env.local` temporarily.

Multi-user storage should use:

```text
user_login_states
- id
- user_id
- provider
- encrypted_cookie
- status: active | expired | revoked
- last_verified_at
- created_at
- updated_at
```

Expiry handling:

```text
Before sync or on app startup
-> validate Cookie with /user/account
-> if invalid, mark expired
-> C side asks user to scan again
```

## Phase 4: Server Deployment and Multi-User Data Isolation

Goal: support a small group of friends using one deployed app.

Core boundary:

```text
What a song is -> public data.
What a song means to a person -> private user data.
```

Public layer:

```text
songs
song_ai_profiles / song_tags
playback_cache
artist / album metadata as needed
```

Private user layer:

```text
users
user_login_states
user_song_sources
user_song_events
user_profiles
user_recommendation_sessions
user_recommendation_items
```

Migration from current local data:

- `songs.netease_song_id`, title, artists, album, cover, duration, popularity, raw metadata become public song data.
- `songs.tags_json` becomes public song tags or public song AI profiles.
- `songs.sources_json` becomes private `user_song_sources` for the original owner.
- `recent_play_count` and `days_since_last_played` should stop being public song fields.
- `song_events` becomes private `user_song_events`.
- recommendation sessions/items become private user recommendation records.

## Phase 5: Public Base Library Reuse and Background AI Tag Queue

Goal: reuse the owner's already-tagged song library and avoid blocking new users.

New user sync flow:

```text
Sync user NetEase sources
-> match songs by netease_song_id
-> if public song exists, reuse metadata and AI tags
-> if missing, insert public song metadata
-> if missing AI tags, enqueue background tagging
```

Tagging priority:

- Liked songs.
- Recently played songs.
- High-frequency playlist songs.
- Songs selected as recommendation candidates.
- Public songs missing AI tags.

The player and recommendation flow must remain usable while tags are incomplete. Untagged songs can participate with lower confidence.

## Phase 6: Lightweight Continuous User Profile

Goal: add memory to the recommendation system without creating a heavy personality system.

Profile inputs:

- Long-term source and tag preferences.
- Recent playback behavior.
- Explicit feedback.
- Too-familiar and dislike signals.
- Exploration boundaries.

Profile output:

```text
user_profiles
- user_id
- profile_json
- compact_summary
- confidence
- last_refreshed_at
```

The profile is private per user and supports the current recommendation algorithm. It does not replace song profiles, scene intent parsing, or ranking.

## Phase 7: AI Companion Proactive Bubble

Goal: make the listening companion feel present without interrupting playback.

Trigger:

```text
Song is actively playing
-> reaches 30 seconds or a chosen percentage threshold
-> each song triggers at most once
-> AI creates one short companion bubble
-> user may tap bubble to open chat
```

Constraints:

- Do not auto-open chat.
- Do not pause or interrupt music.
- Do not speak too often.
- Use current song, current lyric line if available, and recent chat context.

## Implementation Order

Recommended order:

1. Phase 1: B/C code and route split with zero behavior change.
2. Phase 3: QR Cookie persistence and expiry handling.
3. Phase 2: C-side first-use onboarding.
4. Phase 4: server deployment and multi-user data isolation.
5. Phase 5: public base library reuse and background AI tag queue.
6. Phase 6: lightweight continuous user profile.
7. Phase 7: AI companion proactive bubble.

Phase 2 and Phase 3 are tightly related. If implementation reveals the QR persistence is needed first, Phase 3 can be completed before the visible onboarding changes.

## Testing Strategy

Phase 1:

- Add shell rendering tests for C and B app wrappers.
- Run existing workbench tests unchanged.
- Run typecheck.

Phase 2:

- Test first-use state with no login and no library.
- Test logged-in empty-library state.
- Test transition from login success to preparing to playable queue.
- Test that admin details are not shown on C side.

Phase 3:

- Test QR authorized response persistence.
- Test invalid Cookie rejection.
- Test expired Cookie status.
- Test re-login replacing old Cookie.

Phase 4:

- Repository tests must prove user A and user B events do not leak.
- Public song tags must be shared.
- User sources, feedback, and sessions must filter by user id.

Phase 5:

- Test public tag reuse for existing songs.
- Test missing tags enqueue background work.
- Test recommendation remains available with partial tags.

Phase 6:

- Test profile summary generation from user-private signals.
- Test no profile data leaks across users.
- Test recommendations still work without a profile.

Phase 7:

- Test proactive bubble threshold.
- Test one bubble per song.
- Test no auto-open chat.

## Open Decisions

- Exact auth method for app-level users before NetEase connection: invite code, simple account login, or first-session local identity.
- Whether the first deployed database remains SQLite or moves to Postgres during Phase 4.
- Whether QR persistence in single-user mode writes `.env.local` or starts directly with a database-backed login state.
- How much of the current owner library should be seeded as the public base library during deployment.
