# Trusted AI Music System Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前音乐应用从“能推荐”推进到“可信的 AI 私人音乐系统”：默认可听、AI 可审计、歌曲可播放、标签可追踪、播放历史会影响后续推荐。

**Architecture:** 后端以 SQLite 本地曲库为唯一可信数据源，网易云只负责导入、扩充和刷新播放地址，DeepSeek 只负责意图解析、AI 打标和推荐重排。前端播放器只展示真实曲库结果，所有兜底都必须带来源标记，不能伪装成 AI 推荐。`/flow` 是审计页，必须把一次推荐从输入到输出的每个节点都展示出来。

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite repository layer, Vitest, Playwright, DeepSeek via existing OpenAI-compatible provider, NetEase API provider, local playback proxy.

---

## Current State

这些能力已经部分完成，执行时先验证，不要重复重构：

- AI tag 已开始改成 `ai:*` 命名空间，推荐匹配兼容 `scene:focus` 与 `ai:scene:focus`。
- DeepSeek 重排已经尝试返回 50 首队列，并记录 AI 原始输入/输出。
- `/flow` 已能显示 AI 请求输入、原始返回、解析 JSON。
- 推荐结果已区分 `selectionSource: "ai" | "local_fill" | "default_liked"` 的类型基础。
- 播放冷却链路写到一半：`recordSongPlayback()` 已在 `appServices.ts` 中出现，但 repository 方法、冷却查询、API route、前端上报还没闭合。

执行原则：

- 不允许 mock 歌曲冒充真实数据。
- 不允许 DeepSeek 未调用成功时显示“AI 推荐成功”。
- 本地补齐、默认我喜欢随机播放、AI 返回不足都必须在 UI 和 `/flow` 中明示。
- 所有用户可见文案必须是可读中文，不能出现乱码或英文占位。

---

## File Structure

**Backend orchestration**

- Modify: `src/lib/appServices.ts`
  - 负责默认队列、推荐响应、AI 调用编排、播放事件写入、冷却过滤、flow 汇总。
- Modify: `src/lib/repositories/musicRepository.ts`
  - 负责 SQLite 歌曲、事件、播放历史查询与写入。
- Modify: `src/lib/db/types.ts`
  - 如需要，补充播放事件 context 类型。
- Create: `src/app/api/play-events/route.ts`
  - 前端播放进度上报入口。
- Create: `src/app/api/default-queue/route.ts`
  - 首屏默认“我喜欢”随机播放队列入口。
- Modify: `src/app/api/recommendations/route.ts`
  - 保持推荐必须有 prompt 且必须真实调用 AI；错误信息保持中文。

**Recommendation and AI**

- Modify: `src/lib/ai/deepseekProvider.ts`
  - 保持 50 首目标重排；失败时保留可审计 trace。
- Modify: `src/lib/ai/tagTaxonomy.ts`
  - 保持 AI tag 命名空间。
- Modify: `src/lib/recommendation/songTags.ts`
  - AI tag 显示、匹配和中文标签。
- Modify: `src/lib/recommendation/ranker.ts`
  - 加入冷却、反馈、播放历史影响。
- Modify: `src/lib/recommendation/types.ts`
  - 确保 `selectionSource`、播放历史摘要、tag 来源类型一致。

**Frontend**

- Modify: `src/components/workbench/Workbench.tsx`
  - 首屏加载默认队列；推荐成功后清空输入；保存 flow；触发自动播放。
- Modify: `src/components/workbench/RecommendationPanel.tsx`
  - 播放事件上报；默认队列/AI/本地补齐来源标记；自动播放；中文文案修复。
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
  - 显示冷却过滤、AI tag 覆盖、AI 返回不足、本地补齐、默认队列节点。
- Modify: `src/components/workbench/recommendationTypes.ts`
  - 补齐新 flow 字段和 item source 字段。

**Tests**

- Modify: `tests/unit/api-contracts.test.ts`
- Modify: `tests/unit/playback-route.test.ts`
- Modify: `tests/unit/workbench.test.tsx`
- Modify: `tests/unit/ai-integration.test.ts`
- Modify: `tests/unit/song-tags.test.ts`
- Modify: `tests/unit/recommendation.test.ts`
- Modify: `tests/e2e/workbench.spec.ts`

---

## Task 1: Restore Test Baseline Around Playback Cooldown

**Files:**

- Modify: `tests/unit/api-contracts.test.ts`
- Modify: `src/lib/appServices.ts`
- Modify: `src/lib/repositories/musicRepository.ts`

- [ ] **Step 1: Run the current failing cooldown test**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t cooldown
```

Expected before implementation: FAIL because playback recording/cooldown helpers are incomplete.

- [ ] **Step 2: Make the test deterministic**

In `tests/unit/api-contracts.test.ts`, change the cooldown test to await playback persistence:

```ts
await recordSongPlayback({
  itemId: "long-fixture-1",
  playedSeconds: 190,
  durationSeconds: 190,
  completed: true
});
```

Expected: TypeScript should force `recordSongPlayback` to become async.

- [ ] **Step 3: Implement repository playback write**

In `src/lib/repositories/musicRepository.ts`, add a method with this behavior:

```ts
recordPlaybackByNeteaseSongId(
  neteaseSongId: string,
  playback: { playedSeconds: number; durationSeconds: number | null; completed: boolean }
) {
  const row = this.getFirst<{ id: number; recent_play_count: number }>(
    "SELECT id, recent_play_count FROM songs WHERE netease_song_id = $id",
    { $id: neteaseSongId }
  );
  if (!row) return null;

  this.addSongEvent({
    songId: row.id,
    eventType: "played",
    source: "local",
    contextText: JSON.stringify(playback),
    weight: playback.completed ? 1 : 0.5
  });

  this.db.run(
    `
      UPDATE songs
      SET recent_play_count = recent_play_count + 1,
          days_since_last_played = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $id
    `,
    { $id: row.id }
  );

  return { itemId: neteaseSongId, playback };
}
```

- [ ] **Step 4: Implement latest playback lookup**

In `src/lib/repositories/musicRepository.ts`, add:

```ts
listLatestPlaybackByNeteaseSongIds(neteaseSongIds: string[]) {
  if (!neteaseSongIds.length) return new Map<string, {
    itemId: string;
    playedSeconds: number;
    durationSeconds: number | null;
    completed: boolean;
    createdAt: string;
  }>();

  const ids = unique(neteaseSongIds);
  const placeholders = ids.map((_, index) => `$id${index}`).join(", ");
  const params = Object.fromEntries(ids.map((id, index) => [`$id${index}`, id]));
  const rows = this.getAll<{
    netease_song_id: string;
    context_text: string | null;
    created_at: string;
  }>(
    `
      SELECT s.netease_song_id, e.context_text, e.created_at
      FROM song_events e
      JOIN songs s ON s.id = e.song_id
      WHERE e.event_type = 'played'
        AND s.netease_song_id IN (${placeholders})
      ORDER BY e.created_at DESC, e.id DESC
    `,
    params
  );

  const result = new Map<string, {
    itemId: string;
    playedSeconds: number;
    durationSeconds: number | null;
    completed: boolean;
    createdAt: string;
  }>();

  for (const row of rows) {
    if (result.has(row.netease_song_id)) continue;
    const parsed = parsePlaybackContext(row.context_text);
    result.set(row.netease_song_id, {
      itemId: row.netease_song_id,
      ...parsed,
      createdAt: row.created_at
    });
  }

  return result;
}
```

Add a private helper near the existing JSON helpers:

```ts
function parsePlaybackContext(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return {
      playedSeconds: Number(parsed.playedSeconds ?? 0),
      durationSeconds: parsed.durationSeconds === null || parsed.durationSeconds === undefined ? null : Number(parsed.durationSeconds),
      completed: Boolean(parsed.completed)
    };
  } catch {
    return { playedSeconds: 0, durationSeconds: null, completed: false };
  }
}
```

- [ ] **Step 5: Make `recordSongPlayback` async**

In `src/lib/appServices.ts`, replace fire-and-forget persistence with awaited repository write:

```ts
export async function recordSongPlayback(input: PlaybackEventInput) {
  const playedSeconds = Math.max(0, Math.floor(input.playedSeconds));
  const durationSeconds =
    input.durationSeconds === null || input.durationSeconds === undefined
      ? null
      : Math.max(0, Math.floor(input.durationSeconds));
  const completed = Boolean(input.completed) || Boolean(durationSeconds && durationSeconds > 0 && playedSeconds / durationSeconds >= 0.8);
  const significant = completed || playedSeconds >= 30 || Boolean(durationSeconds && durationSeconds > 0 && playedSeconds / durationSeconds >= 0.4);

  if (!significant) {
    return { itemId: input.itemId, saved: false, reason: "播放时长不足，未进入冷却。" };
  }

  const repository = await getMusicRepositoryForApp();
  await repository.recordPlaybackByNeteaseSongId(input.itemId, { playedSeconds, durationSeconds, completed });
  return { itemId: input.itemId, saved: true, completed };
}
```

- [ ] **Step 6: Implement cooldown filtering**

In `src/lib/appServices.ts`, make recommendation response fetch latest playback events from repository when using stored library:

```ts
const repository = importedLibrary ? null : await getMusicRepositoryForApp();
const latestPlayback = repository
  ? repository.listLatestPlaybackByNeteaseSongIds(feedbackSongs.map((song) => song.neteaseSongId))
  : new Map();
const cooldownExcluded = collectCooldownExcluded(feedbackSongs, latestPlayback);
```

Implement:

```ts
function collectCooldownExcluded(
  songs: CandidateSong[],
  latestPlayback: Map<string, { playedSeconds: number; durationSeconds: number | null; completed: boolean; createdAt: string }>
): RecommendationFlowCooldownSong[] {
  const now = Date.now();
  return songs.flatMap((song) => {
    const playback = latestPlayback.get(song.neteaseSongId);
    if (!playback) return [];

    const ageDays = Math.max(0, Math.floor((now - new Date(playback.createdAt).getTime()) / 86_400_000));
    const cooldownDays = playback.completed ? 7 : 2;
    if (ageDays >= cooldownDays) return [];

    return [{
      id: song.neteaseSongId,
      name: song.name,
      artistNames: song.artistNames,
      reason: playback.completed ? "完整播放 7 天冷却" : "已听过 2 天冷却",
      cooldownDays
    }];
  });
}
```

- [ ] **Step 7: Verify cooldown unit test**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t cooldown
```

Expected: PASS.

---

## Task 2: Add `/api/play-events` and Frontend Playback Reporting

**Files:**

- Create: `src/app/api/play-events/route.ts`
- Modify: `tests/unit/playback-route.test.ts`
- Modify: `src/components/workbench/RecommendationPanel.tsx`

- [ ] **Step 1: Add failing API test**

In `tests/unit/playback-route.test.ts`, import the new route as `playEventsPost` and add:

```ts
it("records significant playback events", async () => {
  const response = await playEventsPost(
    new Request("http://localhost/api/play-events", {
      method: "POST",
      body: JSON.stringify({
        itemId: "436514312",
        playedSeconds: 45,
        durationSeconds: 180,
        completed: false
      })
    })
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    saved: expect.objectContaining({
      itemId: "436514312",
      saved: true
    })
  });
});
```

- [ ] **Step 2: Create route**

Create `src/app/api/play-events/route.ts`:

```ts
import { z } from "zod";
import { recordSongPlayback } from "@/lib/appServices";

const playbackEventSchema = z.object({
  itemId: z.string().min(1),
  playedSeconds: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  completed: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const parsed = playbackEventSchema.parse(await request.json());
    const saved = await recordSongPlayback(parsed);
    return Response.json({ ok: true, saved });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "播放记录保存失败。" },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 3: Report playback once per song**

In `RecommendationPanel.tsx`, add a `reportedPlaybackRef` set. Report when one of these is true:

- `ended`
- `currentTime >= 30`
- `duration > 0 && currentTime / duration >= 0.4`

POST body:

```ts
{
  itemId: activeItem.id,
  playedSeconds: Math.floor(audio.currentTime),
  durationSeconds: Number.isFinite(audio.duration) ? Math.floor(audio.duration) : null,
  completed
}
```

Rules:

- Do not block playback if the API fails.
- Reset nothing globally; use song ID dedupe so each active song reports once.
- On `ended`, report completed before switching to next song.

- [ ] **Step 4: Add component test**

In `tests/unit/workbench.test.tsx`, add a test that renders `RecommendationPanel`, sets audio time to 45 seconds, fires `timeUpdate`, and expects:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "/api/play-events",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({
      itemId: "101",
      playedSeconds: 45,
      durationSeconds: 185,
      completed: false
    })
  })
);
```

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/unit/playback-route.test.ts tests/unit/workbench.test.tsx -t playback
```

Expected: PASS.

---

## Task 3: Default Liked Random Queue on First Screen

**Files:**

- Create: `src/app/api/default-queue/route.ts`
- Modify: `src/lib/appServices.ts`
- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/workbench/recommendationTypes.ts`
- Modify: `tests/unit/api-contracts.test.ts`
- Modify: `tests/unit/workbench.test.tsx`

- [ ] **Step 1: Add service test**

In `tests/unit/api-contracts.test.ts`, add:

```ts
it("creates a default liked queue from stored playable songs without AI", async () => {
  process.env.MUSIC_DB_PATH = ":memory:";
  resetAppServicesForTests();
  const repository = await getMusicRepositoryForApp();
  repository.upsertCandidateSongs(longFixtureSongs);
  repository.recordSync("netease_import", longFixtureSongs.length, []);

  const body = await createDefaultLikedQueueResponse({ limit: 8 });

  expect(body.items).toHaveLength(8);
  expect(body.items.every((item) => item.selectionSource === "default_liked")).toBe(true);
  expect(body.flow.ai?.calls).toEqual([]);
  expect(body.flow.input.prompt).toBe("默认我喜欢随机播放");
});
```

- [ ] **Step 2: Implement `createDefaultLikedQueueResponse`**

In `src/lib/appServices.ts`, export:

```ts
export async function createDefaultLikedQueueResponse(options: { limit?: number } = {}) {
  const limit = clampRecommendationLimit(options.limit ?? 12);
  const repository = await getMusicRepositoryForApp();
  const library = {
    songs: repository.listCandidateSongs(),
    partialFailures: [],
    stats: repository.getLibraryStats()
  };
  const playableLiked = library.songs.filter(
    (song) => song.streamUrl && (song.sources.includes("liked") || song.tags.includes("source:liked") || song.tags.includes("liked"))
  );
  const queue = shuffleSongs(playableLiked).slice(0, limit).map((song, index) => ({
    song,
    score: 100 - index,
    reason: "来自你的我喜欢随机播放，不是 AI 推荐。",
    breakdown: { liked: 1, random: 1 },
    selectionSource: "default_liked" as const
  }));

  return buildRecommendationResponseFromRankedQueue({
    prompt: "默认我喜欢随机播放",
    context: {
      scene: "default_liked",
      mood: [],
      novelty: "balanced",
      targetTags: [],
      excludeTags: []
    },
    library,
    ranked: queue,
    limit,
    aiCalls: []
  });
}
```

If no helper exists, extract shared response assembly from `createRecommendationResponse` instead of duplicating item mapping.

- [ ] **Step 3: Add route**

Create `src/app/api/default-queue/route.ts`:

```ts
import { createDefaultLikedQueueResponse, getMusicRepositoryForApp } from "@/lib/appServices";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 12);
  const stats = (await getMusicRepositoryForApp()).getLibraryStats();
  if (stats.songs === 0) {
    return Response.json({ error: "本地曲库为空，请先导入网易云歌曲。" }, { status: 404 });
  }
  try {
    return Response.json(await createDefaultLikedQueueResponse({ limit }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "默认播放队列生成失败。" },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 4: Load default queue in `Workbench`**

After `/api/library` returns `counts.songs > 0`, if `result === null`, fetch:

```ts
fetch("/api/default-queue?limit=12")
```

On success:

- set `result`
- call `saveLatestRecommendationResult`
- do not require login
- do not call `/api/sync`
- do not call DeepSeek

- [ ] **Step 5: Add Workbench test**

In `tests/unit/workbench.test.tsx`, add:

```ts
it("loads a default liked queue on first entry when local library exists", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/library") {
      return new Response(JSON.stringify({ counts: { songs: 24, playableSongs: 20, partialFailures: 0 } }));
    }
    if (url === "/api/default-queue?limit=12") {
      return new Response(JSON.stringify(defaultLikedResult));
    }
    if (url === "/api/login/qr") {
      return new Promise<Response>(() => undefined);
    }
    return new Response(JSON.stringify({ ok: true }));
  });

  render(<Workbench />);

  expect(await screen.findByText("默认喜欢歌曲 A")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/recommendations")).toBe(false);
});
```

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "default liked"
npm test -- tests/unit/workbench.test.tsx -t "default liked"
```

Expected: PASS.

---

## Task 4: Recommendation Success UX

**Files:**

- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/workbench/RecommendationPanel.tsx`
- Modify: `tests/unit/workbench.test.tsx`

- [ ] **Step 1: Add tests**

Add tests for:

- successful `/api/recommendations` clears prompt
- failed `/api/recommendations` keeps prompt
- successful recommendation attempts to play first song

Core expectations:

```ts
expect(screen.getByRole("textbox", { name: /听歌场景/i })).toHaveValue("");
expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
```

- [ ] **Step 2: Add explicit autoplay trigger**

In `Workbench.tsx`, add:

```ts
const [autoPlayToken, setAutoPlayToken] = useState(0);
```

On recommendation success:

```ts
setResult(nextResult);
setPrompt("");
setAutoPlayToken((value) => value + 1);
```

Do not clear prompt when response is not ok.

- [ ] **Step 3: Use trigger in `RecommendationPanel`**

Add prop:

```ts
autoPlayToken?: number;
```

When token changes and there is an active item:

```ts
shouldAutoPlayRef.current = true;
const audio = audioRef.current;
if (audio && activePlaybackSrc) playAudio(audio, setIsPlaying, setPlaybackNotice);
```

If browser blocks autoplay, display a Chinese notice and keep the play button enabled.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "recommendation"
```

Expected: PASS.

---

## Task 5: Make AI Selection and Local Fill Visible Everywhere

**Files:**

- Modify: `src/lib/appServices.ts`
- Modify: `src/components/workbench/recommendationTypes.ts`
- Modify: `src/components/workbench/RecommendationPanel.tsx`
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Modify: `tests/unit/api-contracts.test.ts`
- Modify: `tests/unit/workbench.test.tsx`

- [ ] **Step 1: Expose item source in API response**

In `createRecommendationResponse` and default queue response, include:

```ts
selectionSource: item.selectionSource ?? "ai"
```

on each returned item.

- [ ] **Step 2: Update type**

In `recommendationTypes.ts`, add to each item:

```ts
selectionSource?: "ai" | "local_fill" | "default_liked";
```

- [ ] **Step 3: Show source labels in player and queue**

Labels:

- `ai` -> `AI 选中`
- `local_fill` -> `本地补齐`
- `default_liked` -> `我喜欢随机`

Show these near the reason and in queue rows. Keep labels small; they should not dominate the player.

- [ ] **Step 4: Add tests**

Add component assertions:

```ts
expect(screen.getByText("AI 选中")).toBeInTheDocument();
expect(screen.getByText("本地补齐")).toBeInTheDocument();
```

For default queue:

```ts
expect(screen.getByText("我喜欢随机")).toBeInTheDocument();
```

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "local fill"
npm test -- tests/unit/workbench.test.tsx -t "source"
```

Expected: PASS.

---

## Task 6: AI Tag Audit and Tag Backfill Integrity

**Files:**

- Modify: `src/lib/ai/deepseekProvider.ts`
- Modify: `src/lib/ai/tagTaxonomy.ts`
- Modify: `src/lib/recommendation/songTags.ts`
- Modify: `src/lib/appServices.ts`
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Modify: `tests/unit/ai-integration.test.ts`
- Modify: `tests/unit/song-tags.test.ts`
- Modify: `tests/unit/api-contracts.test.ts`

- [ ] **Step 1: Verify current tag tests**

Run:

```bash
npm test -- tests/unit/ai-integration.test.ts tests/unit/song-tags.test.ts tests/unit/api-contracts.test.ts -t "AI tag"
```

Expected: existing AI tag tests should pass or reveal only field drift.

- [ ] **Step 2: Add AI tag flow summary**

In flow response, add:

```ts
tags: {
  totalSongs: library.songs.length,
  aiTaggedSongs: library.songs.filter(hasAiTaggedMarker).length,
  aiTagCoverage: library.songs.length ? aiTaggedSongs / library.songs.length : 0
}
```

Put it under `flow.library` or `flow.tags`; update `recommendationTypes.ts` consistently.

- [ ] **Step 3: Show AI tag audit in `/flow`**

In `RecommendationFlowView.tsx`, show:

- AI 已打标歌曲数
- AI tag 覆盖率
- 本轮是否现场调用 `tagSongs`
- 已保存 AI tag 示例，例如 `ai:scene:focus`

- [ ] **Step 4: Ensure admin batch size is not accidentally 8**

In `Workbench.tsx`, change admin tag request from:

```ts
body: JSON.stringify({ limit: 8 })
```

to:

```ts
body: JSON.stringify({ limit: 100 })
```

Update test expectation.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/unit/ai-integration.test.ts tests/unit/song-tags.test.ts tests/unit/api-contracts.test.ts tests/unit/workbench.test.tsx -t "tag"
```

Expected: PASS.

---

## Task 7: `/flow` Full Dataflow Visualization

**Files:**

- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Modify: `src/components/workbench/recommendationTypes.ts`
- Modify: `tests/unit/workbench.test.tsx`
- Modify: `tests/e2e/workbench.spec.ts`

- [ ] **Step 1: Add missing node coverage**

The full flow page must show these nodes:

1. 用户输入
2. 推荐接口请求
3. 偏好摘要或跳过
4. AI 意图解析
5. 本地曲库读取
6. 播放冷却过滤
7. 续播排除
8. 来源召回
9. 本地排序
10. 标签增强
11. 硬过滤
12. AI 重排
13. 本地补齐
14. 可播放队列
15. 最终输出

For default liked queue, nodes 3, 4, 12 must clearly show `未调用 AI` instead of hiding the nodes.

- [ ] **Step 2: Add cooldown evidence list**

Show `flow.filters.cooldownExcluded` as a separate list:

- song name
- artist
- reason
- cooldown days

- [ ] **Step 3: Add AI/local count evidence**

Show:

- `AI 有效返回 N 首`
- `本地补齐 N 首`
- `默认随机 N 首`

- [ ] **Step 4: Add tests**

Update `tests/unit/workbench.test.tsx` to expect:

```ts
expect(screen.getByRole("button", { name: /06 播放冷却过滤/ })).toBeInTheDocument();
expect(screen.getByRole("button", { name: /13 本地补齐/ })).toBeInTheDocument();
expect(screen.getByText("完整播放 7 天冷却")).toBeInTheDocument();
```

Update E2E expected node count from `13` to `15`.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "flow"
```

Expected: PASS.

---

## Task 8: Chinese Copy and UI Polish Pass

**Files:**

- Modify: `src/components/workbench/RecommendationPanel.tsx`
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/workbench/DataPanel.tsx`
- Modify: `src/components/workbench/StrategyPanel.tsx`
- Modify: `src/app/api/**/*.ts` error text where needed
- Modify: `tests/unit/workbench.test.tsx`
- Modify: `tests/e2e/workbench.spec.ts`

- [ ] **Step 1: Detect broken copy**

Run:

```bash
rg "鍐|缂|鏇|鎺|鐢|娴|闊|涓|绛|骞|€|�" src tests
```

Expected before polish: any matching app copy must be inspected. Not every match is automatically wrong, but visible UI text should become readable Chinese.

- [ ] **Step 2: Replace user-facing text with readable Chinese**

Examples:

- `输入场景`
- `正在播放`
- `播放队列`
- `推荐逻辑`
- `从输入到歌曲`
- `AI 完整返回`
- `播放地址失效，正在换一首。`
- `来自你的我喜欢随机播放`
- `AI 选中`
- `本地补齐`

Do not change internal test fixture names unless they appear in UI assertions.

- [ ] **Step 3: Keep the player one-screen**

Ensure desktop and mobile:

- `.music-app.player-app` height <= viewport height
- input box is only inside modal
- queue is only inside modal/drawer
- no large permanent song list
- player controls remain visible without vertical scrolling

- [ ] **Step 4: Verify component copy**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx
```

Expected: PASS with readable Chinese expectations.

---

## Task 9: Playback Reality Check and Browser Verification

**Files:**

- Modify only if verification finds defects.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Unit tests**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts tests/unit/ai-integration.test.ts tests/unit/recommendation.test.ts tests/unit/song-tags.test.ts tests/unit/playback-route.test.ts tests/unit/workbench.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Start dev server**

Run:

```bash
npm run dev
```

Use the existing port if it is already running; otherwise use the printed localhost URL.

- [ ] **Step 4: Browser smoke test**

Open `http://127.0.0.1:3000/` and verify:

- first screen shows a real playable queue if local library exists
- audio src is `/api/playback?id=...`
- a range fetch to audio returns `206` and audio bytes
- input modal opens only after clicking the scene button
- AI recommendation clears prompt and attempts playback
- queue drawer contains real songs
- played song posts to `/api/play-events`
- `/flow` opens and shows AI raw return, cooldown, local fill, source labels
- mobile viewport has no full-page vertical scroll

- [ ] **Step 5: E2E**

Run:

```bash
npm test:e2e
```

Expected: PASS. If external NetEase playback is temporarily unavailable, document the exact failing request and whether `/api/playback` returned a clear JSON error or a stale direct media URL.

---

## Task 10: Final Integrity Review

**Files:**

- No required edits unless a gap is found.

- [ ] **Step 1: No fake data audit**

Run:

```bash
rg "mock|fixture|fake|placeholder|music.example|测试歌曲" src
```

Expected:

- Test-only fixtures may remain under `tests`.
- Production `src` must not return fixture songs or `music.example`.

- [ ] **Step 2: AI fallback audit**

Run:

```bash
rg "allowFallback|local_fill|default_liked|requireAi|DeepSeek" src/lib src/app src/components
```

Expected:

- `/api/recommendations` uses `requireAi: true`.
- local fill is visible as `本地补齐`.
- default queue is visible as `我喜欢随机`.
- fallback never pretends to be AI.

- [ ] **Step 3: Flow audit**

Use `/flow` after one recommendation and confirm:

- AI request body is visible.
- AI raw response is visible.
- parsed JSON is visible.
- AI returned count is visible.
- local fill count is visible.
- cooldown excluded songs are visible.
- every final song has a source label.

- [ ] **Step 4: Completion criteria**

Only call the iteration complete when all are true:

- `npm run typecheck` passes.
- targeted unit tests pass.
- Playwright E2E passes or has one documented external-service limitation.
- player can fetch audio through `/api/playback`.
- no visible mojibake in main player, admin page, flow page.
- first screen is usable before AI recommendation.
- recommendation uses DeepSeek or fails loudly.
- `/flow` explains the whole data movement.

---

## Execution Order

Recommended automatic run order:

1. Task 1: finish cooldown backend because current code is partially broken.
2. Task 2: add play event API and frontend reporting.
3. Task 3: add default liked queue.
4. Task 4: clear prompt and autoplay after recommendation.
5. Task 5: expose AI/local/default source labels.
6. Task 6: finish AI tag audit.
7. Task 7: upgrade `/flow`.
8. Task 8: Chinese copy and UI polish.
9. Task 9: typecheck, tests, browser verification.
10. Task 10: final integrity audit.

If a later task uncovers a bug in an earlier layer, stop and fix the earlier layer first. The system should prefer a loud, honest failure over a quiet fake success.
