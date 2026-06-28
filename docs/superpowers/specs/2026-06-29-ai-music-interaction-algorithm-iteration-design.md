# AI Music Interaction And Algorithm Iteration Design

Date: 2026-06-29

## Purpose

This iteration upgrades the app from a basic recommendation player into a mobile-first listening experience where the user can start music immediately, ask for scene-aware recommendations, inspect the full AI workflow, and talk with an AI companion while music keeps playing.

The design combines two tracks that must ship together:

- Interaction optimization: make the player feel immersive, simple, and closer to a mature mobile music app.
- Algorithm optimization: make recommendations more accurate for the user's current scene, especially when the user selects a scene and adds a short natural-language request.

The product must stay honest: every recommended song must come from real local or NetEase data. AI can rank, explain, tag, and chat, but it must not invent songs or pretend fallback data is AI output.

## Product Direction

The main screen is a music player, not an admin dashboard. Admin and data-management functions remain separate.

The app has two primary user surfaces:

- Mobile immersive player: cover view, lyric view, controls, queue, mode switch, and scene input.
- Companion chat page: a full-screen glass-style chat surface with a small persistent player at the top.

The AI role is a listening companion, not a DJ or expert analyst. In visible user-facing copy, AI responses should feel like a friend listening together:

- Good: "这句有点像夜里走回家的感觉。"
- Good: "节奏稳，但不会太困，适合放在背景里。"
- Avoid: "根据多维标签匹配和加权模型分析。"

## Scope

In scope for this iteration:

- Mobile-first player UI refinement based on the current player, not a complete product rewrite.
- Cover view and lyric view switching.
- Synchronized line-by-line lyric display.
- AI companion bubbles on the cover view only.
- Full-screen companion chat page with a mini player island.
- Recommendation mode switch: 红心熟悉, 平衡推荐, 探索新歌.
- Scene entry: fixed scene buttons plus free-text refinement.
- Full AI workflow visualization from user input to final songs.
- AI song profiling at import or expansion time.
- Local Top 200 rough ranking followed by AI Top 50 reranking.
- Playback cooldown, negative feedback, duplicate, and playable checks.

Out of scope for this iteration:

- Multi-user account support.
- Cloud sync.
- Training a custom ML model.
- Replacing NetEase playback sources with downloaded files.
- Directly modifying NetEase playlists.
- A full desktop redesign. Desktop should remain usable, but mobile is the priority.

## Interaction Design

### Main Player

The default player screen fills one mobile viewport. It should not require scrolling for normal listening.

Primary layout:

- Top-left: recommendation workflow or dataflow icon.
- Top-center: current mode label and song title.
- Top-right: queue icon.
- Center: album cover on cover view, lyrics on lyric view.
- Below center: song title, artists, album, and a small number of visible tags.
- Bottom: progress, time, like, previous, play/pause, next, chat.
- Bottom secondary action: "我想听..." opens the scene input sheet.

The queue should not occupy persistent page space. It opens as a drawer or sheet when the queue button is tapped.

### Cover View

Cover view is the default state.

It uses a blurred cover-derived background and transparent glass surfaces. The cover is large enough to be the visual center, but the controls must remain easy to reach on mobile.

AI companion bubbles can appear on this screen. They should be short, casual, and temporary. Tapping a bubble opens the companion chat page.

### Lyric View

The user can tap the cover area to switch to lyrics.

Lyric view should show only a small window around the current lyric line:

- Previous line: dim.
- Current line: larger and bright.
- Next lines: dim.

The lyric view should avoid AI bubbles, recommendation explanations, and dense metadata. It is for focused listening.

The lyric line should be driven by the current playback time and the parsed lyric timestamps. If lyrics are unavailable, show a restrained empty state instead of a fake lyric.

### Scene Input

The input box should not be permanently visible on the player.

The user taps "我想听..." to open a small sheet with:

- Scene buttons.
- Free-text input.
- Generate button.

First-version scene buttons:

- 写代码
- 通勤
- 夜晚
- 睡前
- 运动
- 放松

Scene buttons set the base scene. Free text refines it. For example, "写代码" plus "别太困，有点律动，少人声" should keep the work-focus base while raising rhythm and avoiding sleepy songs.

### Recommendation Modes

Recommendation mode is separate from scene.

Modes:

- 红心熟悉: mostly familiar songs from liked, collected, or recently preferred music.
- 平衡推荐: a mix of familiar library songs and extension sources.
- 探索新歌: more external or less-heard real NetEase candidates.

Mode switching opens a small confirmation sheet:

- 下一首开始
- 立即播放新队列
- 取消

This prevents the player from unexpectedly replacing the current song.

### Companion Chat

The chat page is a full-screen mobile page, visually consistent with the player.

Top structure:

- Back button.
- Dynamic-Island-like mini player with cover, song name, artist, play/pause, next, and progress.

Middle:

- Chat messages.
- AI speaks casually and contextually.
- AI may reference the current song and current lyric line when available.

Bottom:

- Input field.
- Send button.
- No quick action chips in the first version.

Music keeps playing while the user chats. Returning to the player can happen through the back button, tapping the mini player island, or a future swipe-down gesture.

### AI Workflow Visualization

The existing flow page should remain an inspection surface for debugging and trust.

It should show:

- User input: mode, scene, free text, requested count.
- AI scene intent parsing input and full raw output.
- Candidate source ratio and source counts.
- Local filters: playable, cooldown, negative feedback, duplicate.
- Local Top 200 rough ranking and score breakdown.
- AI rerank request with all compressed candidate data.
- AI complete Top 50 response.
- Backend validation results.
- Final first 12 songs sent to the player.
- Any repair request if AI returns too few songs or invalid IDs.

This page is for transparency. It can be dense and technical because the user explicitly wants to inspect the workflow.

## Algorithm Design

### Recommendation Inputs

Each recommendation request combines three layers:

```json
{
  "mode": "balanced",
  "scene": "work_focus",
  "text": "深夜写代码，别太困，少人声"
}
```

Mode controls candidate source mix. Scene provides defaults. Text refines the final listening intent.

### Scene Intent

AI parses mode, scene, free text, and a compact preference summary into a structured scene intent.

Example:

```json
{
  "baseScene": "work_focus",
  "mood": ["calm", "focused"],
  "energy": "medium_low",
  "vocal": "less_vocal",
  "rhythm": "steady",
  "distraction": "low",
  "freshness": "balanced",
  "avoidFlags": ["too_noisy", "too_sleepy"]
}
```

The parser must return controlled fields rather than free-form prose. Raw AI input and output must be stored in the recommendation flow trace.

### Song Profile

Every song should eventually have an AI-assisted profile using the same matching dimensions as the scene intent.

Profile fields:

```json
{
  "sceneFit": ["work_focus", "night"],
  "mood": ["calm", "focused"],
  "energy": "medium_low",
  "vocal": "less_vocal",
  "rhythm": "steady",
  "distraction": "low",
  "freshness": "familiar",
  "avoidFlags": ["too_sleepy"],
  "confidence": 0.78,
  "aiVersion": "song-profile-v1"
}
```

Profile sources:

- NetEase metadata: song name, artists, album, playlist source, similar-source relation, duration, popularity, lyric availability.
- Rule inference: language, live/remix/cover/ost hints, release era, playback state.
- AI profiling: scene fit, mood, energy, vocal presence, rhythm, distraction, avoid flags.
- User behavior correction: liked, disliked, too familiar, skipped, completed, recently played.

AI profiling happens during import or expansion, not during normal recommendation. This keeps recommendation latency stable.

Songs without completed AI profiles can still participate, but with lower confidence. Recommended first-version confidence values:

- AI profiled: 1.0
- Rule-inferred only: 0.45
- Failed or partial profile: 0.3

The Top 50 should cap unprofiled songs at 20% unless the local library has too little profiled data.

### Candidate Source Mix

Mode controls the source mix before ranking.

Recommended first-version ratios:

| Mode | Familiar Library | Library/Similar | NetEase Extension |
| --- | ---: | ---: | ---: |
| 红心熟悉 | 80% | 20% | 0% |
| 平衡推荐 | 45% | 35% | 20% |
| 探索新歌 | 20% | 30% | 50% |

The ratios affect candidate recall, not final ranking. A noisy song should not win simply because the user selected 探索新歌.

All sources must be real stored songs or real NetEase API expansion results. No mock songs are allowed in recommendation output.

### Local Rough Ranking

The local ranker filters and scores candidates before AI reranking.

Hard filters:

- Invalid or missing song ID.
- Known unplayable song when a playable alternative exists.
- Song inside playback cooldown.
- Strong negative feedback.
- Duplicate song ID.
- Excluded IDs from the current queue continuation request.

Scoring weights for the first version:

| Dimension | Weight |
| --- | ---: |
| Scene fit | 25 |
| Sound experience: vocal, rhythm, distraction | 25 |
| Mood | 15 |
| Energy | 12 |
| Mode freshness/source | 10 |
| User behavior feedback | 8 |
| Playable and avoid flags | 5 |

The rough ranker returns Top 200 candidates for AI reranking. It also records score breakdowns for the workflow page.

### AI Reranking

AI receives the scene intent, preference summary, and compressed Top 200 candidate data.

Candidate data sent to AI:

```json
{
  "id": "123456",
  "name": "歌曲名",
  "artists": ["歌手"],
  "album": "专辑",
  "sources": ["liked", "playlist", "netease_similar_song"],
  "tags": ["ai:mood:calm", "ai:scene:focus", "rock"],
  "profile": {
    "sceneFit": ["work_focus", "night"],
    "mood": ["calm", "focused"],
    "energy": "medium_low",
    "vocal": "less_vocal",
    "rhythm": "steady",
    "distraction": "low",
    "freshness": "balanced",
    "avoidFlags": []
  },
  "signals": {
    "localScore": 83.5,
    "lastPlayedDaysAgo": 24,
    "feedback": ["like"],
    "playable": true
  }
}
```

AI has full authority to reorder the Top 200 into a Top 50, but it has no authority to invent or import songs.

Rerank output:

```json
{
  "items": [
    {
      "id": "123456",
      "rank": 1,
      "reason": "节奏稳，但不会太困，适合深夜写代码时放在背景里。"
    }
  ]
}
```

Rules:

- Must return 50 items when 50 valid candidates exist.
- Every returned ID must come from the provided Top 200.
- No duplicate IDs.
- Every item needs a short user-facing reason.
- Reasons should be casual and scene-aware, not model-score explanations.

If AI returns too few items or invalid IDs, the backend issues one repair request with the validation errors and the remaining valid candidate IDs. If repair still fails, the backend may fill from local rank order, but the workflow trace must label those items as local fill instead of AI output.

### Rerank Prompt Style

Use a two-layer prompt style.

System layer:

- Strict JSON only.
- Only choose from candidate IDs.
- Return the requested count.
- Rank by current scene intent and song profile.
- Do not invent songs or metadata.

Judgment layer:

- Judge whether each song fits the user's current moment.
- Prefer songs that help the user enter the requested state.
- Penalize songs that pull the user out of the task.
- Respect negative constraints such as "别太困", "别太吵", and "少人声".
- Write reasons like a listening companion, not a scoring report.

### Playback Cooldown And Feedback

Cooldown:

- Full completion: exclude for 7 days.
- Partial meaningful play: exclude for 2 days.
- Very short accidental play can be ignored or recorded with a weaker penalty.

Positive behavior:

- Played over 60 seconds.
- Played over 40% of the song.
- Marked like.
- Continued listening in the same scene.

Negative behavior:

- Skipped within 15 seconds.
- Marked dislike.
- Marked too familiar.
- Frequent regeneration after a recommendation.
- Playback failure.

First-version behavior signals should tune ranking and preference summaries. They should not train a custom model.

## Data And Persistence Implications

This design implies persistent storage for:

- Song AI profile fields.
- AI profile version and confidence.
- AI tag job state.
- Recommendation mode and selected scene.
- Recommendation flow trace with raw AI inputs and outputs.
- Playback event summaries.
- Feedback events.

The implementation can use the existing SQLite repository pattern. Schema details belong in the implementation plan, but the design requires these data to be queryable by recommendation sessions and visible in the workflow page.

## API Implications

Expected API behavior:

- Recommendation requests accept mode, scene, text, limit, and excluded IDs.
- Default queue remains available for first entry playback and should not call AI.
- Recommendation responses include the final first-page items plus a stored Top 50 continuation pool.
- Flow responses expose trace nodes for intent parsing, local ranking, AI rerank, validation, and local fill.
- Tagging/import APIs enqueue or perform AI song profiling.

The frontend should not infer whether AI was used. The backend response should explicitly report AI calls, AI-selected count, local-fill count, and repair attempts.

## Validation And Quality Metrics

Manual validation:

- Use the workflow page to inspect whether scene intent matches user input.
- Check whether Top 200 candidates are real and plausible.
- Check whether AI Top 50 contains only valid IDs.
- Compare final first 12 songs with the user's expectation for the selected scene.

Behavior metrics:

- Skip within 15 seconds.
- Played over 60 seconds.
- Played over 40%.
- Like/dislike/too familiar.
- Regenerate after recommendation.
- Playback failure.

First success target:

- For common scenes such as 写代码, 夜晚, 睡前, and 通勤, the first 12 songs should visibly match the scene and should not contain fake, unplayable, recently played, or obviously contradictory songs.

## Implementation Boundaries

This document is a design agreement, not an implementation patch.

Implementation should be split into later plan phases:

1. Data schema and repository updates for song profiles and flow traces.
2. AI song profiling pipeline.
3. Scene/mode request contract.
4. Local Top 200 ranker update.
5. AI Top 50 reranker with validation and repair.
6. Player interaction UI update.
7. Chat companion integration.
8. Workflow page expansion.
9. Tests and browser verification.

Each phase should include focused tests. The recommendation flow should be tested with fake AI providers that return valid, invalid, incomplete, and repaired outputs.

