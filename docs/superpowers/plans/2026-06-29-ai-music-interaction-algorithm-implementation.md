# AI Music Interaction Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved interaction and recommendation algorithm iteration end to end, then verify the player, recommendation API, AI flow trace, lyrics, and chat entry work together.

**Architecture:** Keep the current Next.js app and service structure. Add typed mode/scene request contracts, derive song profiles from stored AI tags and metadata, update local ranking and AI reranking flow, then upgrade the mobile player UI around the existing `RecommendationPanel`.

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite repository layer, Vitest, Playwright/in-app browser.

---

### Task 1: Recommendation Contract And Scoring

**Files:**
- Modify: `src/lib/recommendation/types.ts`
- Create: `src/lib/recommendation/songProfile.ts`
- Modify: `src/lib/recommendation/ranker.ts`
- Test: `tests/unit/recommendation.test.ts`

- [ ] Add failing tests for mode-aware and profile-confidence ranking.
- [ ] Add mode, scene, song profile, and profile-confidence types.
- [ ] Implement `buildSongProfile(song)` and `profileConfidence(song)`.
- [ ] Update ranker weights to prioritize scene fit and sound experience.
- [ ] Run `npm test -- tests/unit/recommendation.test.ts`.

### Task 2: Recommendation API Flow

**Files:**
- Modify: `src/lib/appServices.ts`
- Modify: `src/lib/ai/types.ts`
- Modify: `src/lib/ai/deepseekProvider.ts`
- Modify: `src/lib/ai/fallbackProvider.ts`
- Modify: `src/app/api/recommendations/route.ts`
- Test: `tests/unit/api-contracts.test.ts`
- Test: `tests/unit/ai-integration.test.ts`

- [ ] Add failing tests for `mode`, `scene`, `text`, Top 200 local candidates, Top 50 AI pool, repair/local-fill labeling, and flow trace fields.
- [ ] Pass mode/scene/text into AI context parsing.
- [ ] Build mode source mix metadata and expose it in `flow`.
- [ ] Send compressed song profiles to AI rerank.
- [ ] Keep backend validation: no invented IDs, no duplicates, playable only, cooldown and negative feedback excluded.
- [ ] Return first page items while preserving Top 50 details in the flow.
- [ ] Run `npm test -- tests/unit/api-contracts.test.ts tests/unit/ai-integration.test.ts`.

### Task 3: Player Interaction

**Files:**
- Modify: `src/components/workbench/recommendationTypes.ts`
- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/workbench/RecommendationPanel.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/workbench.test.tsx`

- [ ] Add failing tests for scene buttons, mode switch request body, lyric fetch on cover tap, chat overlay entry, and prompt clearing/autoplay preservation.
- [ ] Add Workbench state for recommendation mode and scene.
- [ ] Update scene sheet to use fixed scene buttons plus free text.
- [ ] Add mode switch control and confirmation sheet.
- [ ] Add cover/lyrics view with line-synced lyric window.
- [ ] Add companion bubble and full-screen chat shell.
- [ ] Run `npm test -- tests/unit/workbench.test.tsx`.

### Task 4: Workflow Visualization And Whole-Chain Verification

**Files:**
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Test: `tests/unit/workbench.test.tsx`
- Test: `tests/e2e/workbench.spec.ts`

- [ ] Add failing tests that the flow page exposes mode, scene, Top 200, Top 50, AI raw returns, local fill, and validation details.
- [ ] Extend flow view labels and details without hiding raw AI input/output.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Start the dev server and verify the main player, scene recommendation, lyrics, chat, queue, and flow page in the browser.

