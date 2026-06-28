# Personal Music Recommender Design

Date: 2026-06-26

## Purpose

Build a local web recommendation workbench that helps one user get better single-song recommendations than their current music app recommendations. The tool uses the user's NetEase Cloud Music data, their current listening context, and lightweight feedback to recommend songs that feel more aware of mood, scene, freshness, and fatigue.

The first version is an MVP. Its job is to prove the recommendation loop:

1. Import NetEase music data.
2. Build a local preference profile.
3. Accept a natural-language listening context.
4. Generate single-song recommendations.
5. Let the user listen and give lightweight feedback.
6. Make the next recommendation round change based on that data.

## Product Scope

The product is a local-only web app for personal use. It is not a public web service, social product, full music player, or multi-user system.

In scope for the MVP:

- Local React web workbench built with Next.js, TypeScript, and SQLite.
- NetEase QR login as the primary import path.
- Manual import fallback for playlist links or song IDs.
- Import of liked songs, owned or subscribed playlists, playlist tracks, recent plays, listening rankings, similar songs, and similar playlists.
- A local "My Music Preferences" profile computed from imported data, explicit feedback, and light usage behavior.
- AI provider abstraction, with OpenAI as the default provider.
- AI-assisted listening-context parsing and recommendation reason generation.
- Rule-based recommendation engine with extensible candidate-source and ranking interfaces.
- Single-song recommendations only.
- NetEase iframe playback where possible, with a NetEase external-link fallback.
- Feedback actions: like, dislike, too familiar, more like this, later.
- Simple quality metrics per recommendation round.

Out of scope for the MVP:

- Vector search.
- Python ML model training.
- Direct creation or update of NetEase playlists.
- Audio file downloading, proxying, or source replacement.
- Cloud sync.
- Multi-user accounts.
- Full player features such as lyrics, MV, global shortcuts, or desktop integration.
- Complex behavioral tracking.

## Reference Project

The UI and NetEase interaction should take visual and interaction inspiration from YesPlayMusic (`qier222/YesPlayMusic`), especially its polished music-list presentation, cover treatment, playback feel, login flow, and light/dark music-app atmosphere.

The MVP must not fork or build on YesPlayMusic. YesPlayMusic is Vue/Electron/player-oriented, while this project is a React/Next.js recommendation workbench. Its role is reference only.

## Architecture

The app uses:

- Next.js for the local React web app and API routes.
- TypeScript across UI, services, and recommendation logic.
- SQLite for local persistence.
- A NetEase API service based on the NeteaseCloudMusicApi ecosystem.
- An AI provider interface, defaulting to OpenAI.

The system is split into six modules.

### NetEase Integration

Responsibilities:

- QR login.
- Login status checks.
- Local encrypted cookie persistence.
- Data sync for liked songs, playlists, playlist songs, recent plays, listening rankings, similar songs, and similar playlists.
- Manual import fallback for playlist links and song IDs.

Failures in one import source must not block the rest of the app. If similar songs fail but playlists succeed, the app should still recommend from available data.

### Local Data Layer

Responsibilities:

- Store users, songs, playlists, playlist-song relationships, song events, recommendation sessions, recommendation items, feedback, and encrypted login state.
- Expose repository/service APIs to the rest of the app.
- Keep database access out of React components.

### My Music Preferences

This module computes a local preference profile from imported NetEase data and local behavior.

It should include:

- Frequent artists.
- Frequent playlist tags or inferred categories when available.
- Recently repeated songs.
- Liked songs that have not been played recently.
- Songs or artists with negative feedback.
- Context-specific preferences over time.
- A rough exploration/familiarity tendency.

This profile is local, concrete, and explainable. It is not uploaded as raw data to a cloud service.

### AI Provider

The AI provider interface supports:

- `parseListeningContext(input, profileSummary)`: convert natural language into structured context.
- `summarizePreference(profileData)`: create a compact local preference summary.
- `generateReasons(recommendations, context, scoreBreakdowns)`: produce short recommendation reasons.

OpenAI is the default implementation. The interface must allow future providers such as local models or other APIs.

AI must not directly decide the final recommendation list. It provides understanding and explanation; the recommendation engine remains the controlled ranking layer.

### Recommendation Engine

The recommendation engine has two separable stages:

- Candidate recall.
- Candidate ranking.

Candidate sources should implement a common interface so future vector search or Python model outputs can be added without rewriting the app.

Initial candidate sources:

- Liked-song related candidates.
- Songs from user playlists.
- Recent-play related candidates.
- Frequent-artist related candidates.
- NetEase similar-song candidates.
- NetEase similar-playlist candidates.
- Dormant liked songs.
- A small exploration pool.

Ranking should use explainable score components:

- Long-term preference score.
- Listening-context match score.
- Source confidence score.
- Novelty score.
- Explicit-feedback adjustment.
- Light implicit-behavior adjustment.
- Repetition penalty.
- Fatigue penalty.
- Negative-feedback penalty.

Explicit feedback is a strong correction signal but not required. Recommendations should still work from NetEase history and light usage behavior.

### Recommendation Workbench UI

The UI is a three-column workbench.

Left column:

- NetEase connection status.
- Last sync time.
- Import counts for liked songs, playlists, recent plays, and candidate songs.
- Resync action.
- Manual import entry point.
- Clear login data action.
- "My Music Preferences" summary.

Center column:

- Natural-language listening-context input.
- Scene shortcuts such as work, night, commute, exercise, exploration, and nostalgia.
- Familiarity/exploration control.
- Recommend action.
- Single-song recommendation list.
- NetEase iframe playback or NetEase external-link fallback.
- Feedback buttons on each song.

Right column:

- Parsed listening context.
- Current recommendation strategy.
- Round metrics: like rate, dislike rate, too-familiar rate, more-like-this rate.
- Whole-round subjective rating: good, ok, bad.
- Recent feedback history.

The UI should feel like a music tool, not a marketing landing page. It should borrow YesPlayMusic's polished music-app tone while staying focused on recommendation work.

## Data Flow

### Import Flow

1. User logs in through NetEase QR login.
2. The app encrypts and stores the cookie locally.
3. The app imports liked songs, playlists, playlist songs, recent plays, and listening rankings.
4. The app normalizes song, artist, album, playlist, and event data.
5. Failed sources are recorded and displayed as partial sync issues.
6. Existing usable data remains available even if later syncs partially fail.

### Preference Update Flow

1. Imported NetEase data becomes base preference evidence.
2. Explicit feedback becomes high-weight correction evidence.
3. Light usage behavior becomes auxiliary evidence.
4. Recent behavior is weighted more than stale behavior.
5. The local preference profile is updated after imports and feedback.

### Recommendation Flow

1. User enters a listening context.
2. AI provider parses the context into structured preferences such as scene, mood, energy, vocal preference, novelty, language, and avoid terms.
3. Candidate sources return songs from imported data and NetEase related APIs.
4. The engine deduplicates songs and applies source metadata.
5. The ranker scores candidates using preference, context, freshness, feedback, and penalties.
6. The app returns 10-20 recommendations.
7. AI provider generates short reasons based only on available signals and score breakdowns.
8. The UI displays results with playback and feedback controls.
9. Feedback writes local events and affects the next round.

## Data Model

### `users`

- `id`
- `netease_user_id`
- `nickname`
- `avatar_url`
- `encrypted_cookie`
- `created_at`
- `updated_at`

### `songs`

- `id`
- `netease_song_id`
- `name`
- `artist_names`
- `artist_ids_json`
- `album_name`
- `album_id`
- `cover_url`
- `duration_ms`
- `popularity`
- `raw_json`
- `created_at`
- `updated_at`

### `playlists`

- `id`
- `netease_playlist_id`
- `name`
- `cover_url`
- `creator_name`
- `source_type`: `owned`, `subscribed`, or `liked`
- `raw_json`
- `updated_at`

### `playlist_songs`

- `playlist_id`
- `song_id`
- `position`
- `added_at`

### `song_events`

- `id`
- `song_id`
- `event_type`: `liked`, `playlist_imported`, `played`, `ranked`, `recommended`, or `feedback`
- `source`: `netease`, `manual`, or `local`
- `context_text`
- `weight`
- `created_at`

### `recommendation_sessions`

- `id`
- `prompt`
- `parsed_context_json`
- `strategy_json`
- `overall_rating`: `good`, `ok`, `bad`, or `null`
- `created_at`

### `recommendation_items`

- `id`
- `session_id`
- `song_id`
- `rank`
- `score`
- `source`
- `reason`
- `score_breakdown_json`
- `feedback`: `like`, `dislike`, `too_familiar`, `more_like_this`, `later`, or `null`
- `created_at`

## Privacy And Safety

- NetEase cookie is stored only in local SQLite.
- Cookie is encrypted before persistence.
- The UI provides a clear "clear login data" action.
- The app does not upload raw NetEase data to a custom backend.
- The AI provider receives only necessary summaries and request context, not cookies or full raw import data.
- AI-generated reasons must be grounded in known signals and must not invent music facts.
- Audio files are not downloaded, proxied, or redistributed.
- Playback uses NetEase iframe or NetEase links only.

## Error Handling

- Login failure: show a retryable QR login state.
- Cookie expiration: prompt for login again while preserving local history.
- Partial sync failure: show the failed source and allow retry.
- Similar-song or similar-playlist failure: skip that candidate source and continue.
- AI provider failure: fall back to simple rule parsing and template reasons.
- iframe failure: show a NetEase external link.
- SQLite write failure: show an explicit error and prevent recommendation state from pretending feedback was saved.
- Manual import format errors: show item-level failures where possible.

## Testing Strategy

The MVP should include focused tests for the highest-risk logic:

- Recommendation scoring unit tests.
- Candidate deduplication tests.
- Repetition, fatigue, and negative-feedback penalty tests.
- Feedback action persistence tests.
- AI provider mock tests.
- NetEase API service tests with mocked responses.
- SQLite repository tests for core write/read paths.
- Workbench smoke tests for import state, recommendation request, result rendering, playback fallback, and feedback actions.

## Acceptance Criteria

Functional criteria:

- User can run the app locally.
- User can log in to NetEase with QR code.
- User can import liked songs, playlists, playlist songs, recent plays, and listening rankings.
- User can manually import playlist links or song IDs if automatic import fails.
- User can enter a natural-language listening context.
- App returns 10-20 single-song recommendations.
- Recommendations come from multiple candidate sources, not only liked songs.
- App displays short reasons and score explanations.
- App provides NetEase iframe playback or external-link fallback.
- User can apply the five feedback actions.
- Feedback changes later recommendation results.
- User can see round metrics and provide a whole-round subjective rating.

Quality criteria:

- Recent high-frequency songs are penalized unless the context strongly asks for familiarity.
- One artist or playlist cannot dominate an entire recommendation round.
- Songs marked "later" do not reappear in the short term.
- The app remains useful if the user gives no explicit feedback.
- Cookie is not stored in plain text.
- Cookie and full raw NetEase data are not sent to AI.
- AI failure does not stop recommendation.
- Candidate recall and ranking are separated behind interfaces.
- AI provider is replaceable.
- Future vector search or Python recommender output can be added as candidate sources or ranking signals.

## MVP Success Definition

The MVP is successful when the user can complete the loop:

1. Import NetEase data.
2. Enter a listening context.
3. Get playable recommendations.
4. Give lightweight feedback.
5. See the next round change in a plausible and explainable way.

The product is considered promising if, after several rounds, the user's subjective rating improves and the too-familiar/dislike rates trend down while like/more-like-this rates trend up.
