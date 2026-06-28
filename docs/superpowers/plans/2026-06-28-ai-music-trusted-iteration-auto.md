# AI Music Trusted Iteration Auto Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前音乐应用收口成可信的 AI 私人音乐系统：首屏能直接播放真实歌曲，AI 推荐必须真实调用并可追踪，AI 标签必须入库，播放历史会影响后续推荐，推荐链路和 AI 原始输入输出都能在 `/flow` 看清楚。

**Architecture:** SQLite 是唯一可信本地曲库，网易云只负责同步、扩充和刷新可播放信息，DeepSeek 只负责意图解析、AI 打标和推荐重排。前端播放器始终通过 `/api/playback?id=...` 播放，不直接使用过期的网易云媒体直链。所有非 AI 结果必须明确标注来源，不能伪装成 AI。

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite repository layer, Vitest, Playwright, DeepSeek OpenAI-compatible API, NeteaseCloudMusicApiEnhanced, local playback proxy.

---

## Scope

本计划用于当前自动目标继续执行，不重新设计整个产品，不重写 UI 架构，不引入新数据库技术。

已经完成或基本完成的能力先通过测试确认，不重复重构：

- `/api/play-events` 已创建，前端播放达到阈值会写入播放事件。
- `/api/default-queue` 已创建，首屏可从本地我喜欢随机队列启动。
- 后端已经有播放冷却过滤基础。
- 后端已经有 `selectionSource: "ai" | "local_fill" | "default_liked"` 的基础字段。
- DeepSeek 推荐失败时不能静默兜底成 AI 推荐。

本轮必须完成的剩余闭环：

- 推荐成功后清空输入框，并自动尝试播放第一首。
- 默认我喜欢队列也要尽量自动尝试播放。
- 所有歌曲在播放器和队列里显示来源标签。
- AI 打标批量从 8 调整为 100，并在 `/flow` 显示 AI 标签覆盖率。
- `/flow` 从 13 个节点扩展到 15 个节点，展示冷却、本地补齐、默认无 AI 状态和完整 AI 原始返回。
- 清理用户可见乱码中文。
- 通过 typecheck、单元测试、浏览器播放代理验证和假数据审计。

---

## File Map

**Backend orchestration**

- Modify: `src/lib/appServices.ts`
  - 补齐 flow 的 tag 覆盖率、冷却统计、来源统计。
  - 确保推荐必须真实调用 DeepSeek 或失败。
  - 确保默认队列明确 `default_liked`，AI calls 为空。
- Modify: `src/lib/repositories/musicRepository.ts`
  - 仅在测试发现播放历史查询或写入缺口时修改。
- Modify: `src/app/api/recommendations/route.ts`
  - 仅在错误信息或 requireAi 链路不一致时修改。
- Modify: `src/app/api/default-queue/route.ts`
  - 仅在默认队列错误信息或返回字段不一致时修改。
- Modify: `src/app/api/play-events/route.ts`
  - 仅在验证发现播放事件校验不完整时修改。
- Modify: `src/app/api/tags/route.ts`
  - 保持接收 `{ limit }`，确保返回真实 AI 打标结果和中文错误。

**Frontend player and flow**

- Modify: `src/components/workbench/Workbench.tsx`
  - 新增 `autoPlayToken`。
  - 推荐成功清空 prompt 并触发自动播放。
  - 默认队列加载成功也可以触发自动播放。
  - AI 打标请求 limit 从 8 改成 100。
- Modify: `src/components/workbench/RecommendationPanel.tsx`
  - 使用 `autoPlayToken` 自动播放。
  - 显示 `AI 选中`、`本地补齐`、`我喜欢随机`。
  - 清理用户可见乱码文案。
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
  - 扩展为 15 个节点。
  - 显示冷却列表、AI/local/default 数量、AI tag 覆盖率。
  - 默认队列时明确显示“未调用 AI”。
- Modify: `src/components/workbench/recommendationTypes.ts`
  - 补齐 `selectionSource` 和 flow tag 字段类型。
- Modify: `src/components/workbench/DataPanel.tsx`
  - 清理乱码文案，必要时显示 AI 打标批次 100。
- Modify: `src/components/workbench/StrategyPanel.tsx`
  - 清理乱码文案。
- Modify: `src/app/globals.css`
  - 仅在一屏适配、标签显示或弹窗布局需要时修改。

**Tests**

- Modify: `tests/unit/workbench.test.tsx`
- Modify: `tests/unit/api-contracts.test.ts`
- Modify: `tests/unit/ai-integration.test.ts`
- Modify: `tests/unit/song-tags.test.ts`
- Modify: `tests/unit/playback-route.test.ts`
- Modify: `tests/unit/recommendation.test.ts`
- Modify: `tests/e2e/workbench.spec.ts`

---

## Task 0: Baseline Audit

**Files:**

- Read: all files listed in File Map.
- Modify only if a test reveals a regression.

- [ ] **Step 1: Confirm no git workspace assumption**

Run:

```bash
git status --short
```

Expected: this workspace may not be a git repo. If it fails, continue without git commands.

- [ ] **Step 2: Run current focused tests**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "prompt|default liked|playback|flow|tag"
```

Expected: at least one test may fail around prompt/autoplay, source labels, flow node count, or tag limit. Record the exact failing assertions before editing.

- [ ] **Step 3: Run backend focused tests**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts tests/unit/playback-route.test.ts -t "cooldown|default liked|local fill|playback"
```

Expected: existing completed backend work should pass. If it fails, fix backend regression before touching UI.

---

## Task 1: Recommendation Success and Autoplay

**Files:**

- Modify: `tests/unit/workbench.test.tsx`
- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/workbench/RecommendationPanel.tsx`

- [ ] **Step 1: Ensure failing tests exist**

The tests must cover:

```ts
it("clears the prompt and tries to play after successful recommendation generation", async () => {
  // user enters a scene, API returns recommendationResult
  // expect HTMLMediaElement.prototype.play to be called
  // reopen the scene dialog and expect textarea value to be ""
});

it("keeps the prompt when recommendation generation fails", async () => {
  // API returns 400
  // reopen the scene dialog and expect textarea still has previous prompt
});
```

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "prompt"
```

Expected before implementation: the autoplay assertion fails if `autoPlayToken` is not wired through `Workbench`.

- [ ] **Step 2: Add autoplay token state in Workbench**

In `src/components/workbench/Workbench.tsx`, add:

```ts
const [autoPlayToken, setAutoPlayToken] = useState(0);
```

On recommendation success for a fresh recommendation:

```ts
setResult(nextResult);
saveLatestRecommendationResult(nextResult);
setSyncCounts(data.libraryCounts);
setSyncFailures(data.strategy.partialFailures ?? []);

if (!append) {
  setPrompt("");
  setAutoPlayToken((value) => value + 1);
}
```

Do not clear prompt when `response.ok` is false.

- [ ] **Step 3: Pass token to RecommendationPanel**

In the `RecommendationPanel` JSX:

```tsx
<RecommendationPanel
  ...
  autoPlayToken={autoPlayToken}
/>
```

- [ ] **Step 4: Trigger autoplay for default liked queue**

After `loadDefaultQueue` successfully sets a first result, call:

```ts
setAutoPlayToken((value) => value + 1);
```

Guard it so it only happens when the current result was empty and the loaded queue is accepted.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "prompt|default liked"
```

Expected: PASS.

---

## Task 2: Visible Source Labels

**Files:**

- Modify: `tests/unit/workbench.test.tsx`
- Modify: `src/components/workbench/recommendationTypes.ts`
- Modify: `src/components/workbench/RecommendationPanel.tsx`
- Modify: `src/lib/appServices.ts` only if API items omit `selectionSource`.

- [ ] **Step 1: Add source label tests**

Add or update tests so the player and queue show:

```ts
expect(screen.getByText("AI 选中")).toBeInTheDocument();
expect(screen.getByText("本地补齐")).toBeInTheDocument();
expect(screen.getByText("我喜欢随机")).toBeInTheDocument();
```

Use fixtures with these item fields:

```ts
selectionSource: "ai"
selectionSource: "local_fill"
selectionSource: "default_liked"
```

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "source"
```

Expected before implementation: labels are missing.

- [ ] **Step 2: Update item type**

In `src/components/workbench/recommendationTypes.ts`, add to `RecommendationResponse.items[]`:

```ts
selectionSource?: "ai" | "local_fill" | "default_liked";
```

- [ ] **Step 3: Add label helper**

In `src/components/workbench/RecommendationPanel.tsx`, add:

```ts
function selectionSourceLabel(source?: "ai" | "local_fill" | "default_liked") {
  if (source === "local_fill") return "本地补齐";
  if (source === "default_liked") return "我喜欢随机";
  return "AI 选中";
}
```

- [ ] **Step 4: Show labels**

Show the label near the active song reason:

```tsx
<p className="reason">
  <span className="source-pill">{selectionSourceLabel(activeItem.selectionSource)}</span>
  {activeItem.reason}
</p>
```

Show it in every queue row:

```tsx
<span className="queue-source">
  {selectionSourceLabel(item.selectionSource)}
</span>
```

If playback is unavailable, show both source and copyright state without hiding source.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "source|queue|category"
```

Expected: PASS.

---

## Task 3: AI Tag Batch and Tag Audit

**Files:**

- Modify: `tests/unit/workbench.test.tsx`
- Modify: `tests/unit/api-contracts.test.ts`
- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/lib/appServices.ts`
- Modify: `src/components/workbench/recommendationTypes.ts`
- Modify: `src/components/workbench/RecommendationFlowView.tsx`

- [ ] **Step 1: Update admin tag test**

In `tests/unit/workbench.test.tsx`, change the expected request body:

```ts
body: JSON.stringify({ limit: 100 })
```

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "AI tag enrichment"
```

Expected before implementation: FAIL because current UI sends `{ limit: 8 }`.

- [ ] **Step 2: Change UI tag limit**

In `src/components/workbench/Workbench.tsx`, replace:

```ts
body: JSON.stringify({ limit: 8 })
```

with:

```ts
body: JSON.stringify({ limit: 100 })
```

- [ ] **Step 3: Add flow tag summary test**

In `tests/unit/api-contracts.test.ts`, assert the recommendation flow includes AI tag audit data:

```ts
expect(body.flow.tags).toEqual(
  expect.objectContaining({
    totalSongs: expect.any(Number),
    aiTaggedSongs: expect.any(Number),
    aiTagCoverage: expect.any(Number)
  })
);
```

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "AI tag"
```

Expected before implementation: FAIL because `flow.tags` is missing.

- [ ] **Step 4: Add `flow.tags` in appServices**

In both `createRecommendationResponse` and `createDefaultLikedQueueResponse`, compute:

```ts
const totalSongs = library.songs.length;
const aiTaggedSongs = library.songs.filter(hasAiTaggedMarker).length;
const aiTagCoverage = totalSongs ? aiTaggedSongs / totalSongs : 0;
```

Return:

```ts
tags: {
  totalSongs,
  aiTaggedSongs,
  aiTagCoverage,
  examples: library.songs
    .flatMap((song) => song.tags)
    .filter((tag) => tag.startsWith("ai:"))
    .slice(0, 12)
}
```

- [ ] **Step 5: Update frontend type**

In `RecommendationFlow`, add:

```ts
tags?: {
  totalSongs: number;
  aiTaggedSongs: number;
  aiTagCoverage: number;
  examples?: string[];
};
```

- [ ] **Step 6: Display tag audit**

In `/flow`, show:

- `AI 已打标歌曲`
- `AI 标签覆盖率`
- `AI tag 示例`
- `本轮是否调用 AI 打标`

Use Chinese labels. Do not show this as AI recommendation if `flow.ai.calls` has no tagging call.

- [ ] **Step 7: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "tag"
npm test -- tests/unit/api-contracts.test.ts -t "AI tag"
```

Expected: PASS.

---

## Task 4: Full `/flow` Visualization

**Files:**

- Modify: `tests/unit/workbench.test.tsx`
- Modify: `tests/e2e/workbench.spec.ts`
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Modify: `src/components/workbench/recommendationTypes.ts`

- [ ] **Step 1: Update node count tests**

Change flow page expectations from 13 to 15 nodes.

Required node titles:

```text
01 用户输入
02 推荐接口请求
03 偏好摘要或跳过
04 AI 意图解析
05 本地曲库读取
06 播放冷却过滤
07 续播排除
08 来源召回
09 本地排序
10 标签增强
11 硬过滤
12 AI 重排
13 本地补齐
14 可播放队列
15 最终输出
```

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "flow page"
```

Expected before implementation: FAIL because the page still says 13 nodes and lacks separate cooldown/local fill nodes.

- [ ] **Step 2: Split current nodes**

In `buildWorkflowNodes`, replace the existing 13-node array with 15 nodes:

- Existing `played-exclusion` becomes node 7 `续播排除`.
- Add node 6 `播放冷却过滤` using `flow.filters.cooldownExcluded ?? []`.
- Add node 13 `本地补齐` using `flow.ranking.localFillCount ?? 0`.
- Move playable queue to node 14.
- Move final output to node 15.

- [ ] **Step 3: Default queue must show no-AI state**

For default liked queue:

- Node 3 shows `缺少画像，已跳过`.
- Node 4 shows `默认播放未调用 AI`.
- Node 12 shows `未调用 AI 重排`.
- Node 13 shows `默认我喜欢随机，不是本地补齐`.

- [ ] **Step 4: Add cooldown evidence list**

Add a visible list for `flow.filters.cooldownExcluded` showing:

- song name
- artist names
- reason
- cooldown days

Empty state:

```text
本轮没有歌曲命中播放冷却。
```

- [ ] **Step 5: Add source count evidence**

Show:

```text
AI 选中 N 首
本地补齐 N 首
我喜欢随机 N 首
```

The default liked count can be computed from final items where `selectionSource === "default_liked"`.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "flow"
```

Expected: PASS.

---

## Task 5: Chinese Copy and One-Screen Player Polish

**Files:**

- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/workbench/RecommendationPanel.tsx`
- Modify: `src/components/workbench/RecommendationFlowView.tsx`
- Modify: `src/components/workbench/DataPanel.tsx`
- Modify: `src/components/workbench/StrategyPanel.tsx`
- Modify: `src/app/api/**/*.ts` where user-facing errors are malformed.
- Modify: `src/app/globals.css`
- Modify: related tests.

- [ ] **Step 1: Scan visible mojibake**

Run:

```bash
rg "�|锛|鏇|鎺|杈|绛|鍚|涓|棣|韬|閫|妯|姝|缃" src/components src/app tests/unit/workbench.test.tsx
```

Expected: many matches may be legitimate test fixture artifacts, but any user-facing UI text in `src/components` or API error messages must be fixed to readable Chinese.

- [ ] **Step 2: Replace core player copy**

Use readable Chinese for these visible strings:

```text
正在播放
播放队列
推荐逻辑
当前歌曲
未知歌手
未知专辑
播放地址失效，正在换一首。
播放启动失败，请再点一次或换一首。
我想听...
输入心情或选择一个场景
听歌场景
生成推荐
正在生成
打开完整流程页
```

- [ ] **Step 3: Replace admin copy**

Use readable Chinese for:

```text
网易云登录
网易云已连接
同步网易云数据
扩充曲库
补充 AI 标签
保存 Cookie
更换账号
请先保存有效的网易云 Cookie
```

- [ ] **Step 4: Replace flow copy**

Use readable Chinese for:

```text
推荐生成流程
数据流节点图
当前节点详情
节点输入
处理动作
节点输出
AI 完整返回
请求输入
原始返回
解析后 JSON
```

- [ ] **Step 5: Keep player within one viewport**

In CSS, verify the player mode uses viewport-constrained layout:

```css
.music-app.player-app {
  min-height: 100dvh;
  height: 100dvh;
  overflow: hidden;
}

.music-stage {
  height: 100%;
}
```

If mobile still scrolls, adjust player shell/dock sizing with `minmax(0, 1fr)` and modal/drawer internal scroll only.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx
```

Expected: PASS with tests updated to readable Chinese.

---

## Task 6: Playback Reality Verification

**Files:**

- Modify only if verification finds defects.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Targeted unit tests**

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

Use the printed URL. If port 3000 is occupied by the current app, keep using it.

- [ ] **Step 4: Browser verification**

Open:

```text
http://127.0.0.1:3000/
```

Verify:

- 首屏不是空等 AI，而是显示本地我喜欢随机队列。
- audio `src` 是 `/api/playback?id=...`。
- 播放请求不会直接访问 `m701.music.126.net/...mp3`。
- 点击播放后能听到真实歌曲，或显示清楚的版权/代理错误。
- 播放 30 秒或超过 40% 后会 POST `/api/play-events`。
- 推荐成功后输入框清空。
- 推荐成功后尝试播放第一首。
- 队列弹窗里每首歌都有来源标签。
- `/flow` 有 15 个节点，并能看到 AI 原始请求、原始返回、解析 JSON、冷却过滤、本地补齐和 AI tag 覆盖率。
- 移动端一屏内主要播放器可用，输入框和队列都在弹窗/抽屉里。

- [ ] **Step 5: E2E**

Run:

```bash
npm test:e2e
```

Expected: PASS. If NetEase 外部播放服务临时不可用，记录确切请求、HTTP 状态码，以及 `/api/playback` 是否给出清楚错误，不能把失败包装成成功。

---

## Task 7: Integrity Audit

**Files:**

- Modify only if audit finds production defects.

- [ ] **Step 1: Fake data audit**

Run:

```bash
rg "music.example|placeholder|fake|mock|fixture|测试歌曲|预设歌单" src
```

Expected:

- `src` 里不能返回测试歌曲、假媒体地址或预设歌单。
- 测试数据只能存在于 `tests`。

- [ ] **Step 2: AI fallback audit**

Run:

```bash
rg "allowFallback|requireAi|local_fill|default_liked|DeepSeek" src/lib src/app src/components
```

Expected:

- `/api/recommendations` 使用 `requireAi: true`。
- DeepSeek 缺失或失败时，推荐接口明确失败。
- `local_fill` 只显示为本地补齐。
- `default_liked` 只显示为我喜欢随机。
- 没有任何本地逻辑伪装成 AI 推荐。

- [ ] **Step 3: Playback URL audit**

Run:

```bash
rg "m701.music.126.net|m7.music.126.net|streamUrl" src/components src/lib
```

Expected:

- 前端播放器使用 `playbackProxyUrl(...)`。
- 不把网易云临时 mp3 直链作为 `<audio src>`。

- [ ] **Step 4: Sync behavior audit**

Run:

```bash
rg "/api/sync|/api/default-queue|/api/recommendations" src/components tests/unit/workbench.test.tsx
```

Expected:

- 进入播放器只读 `/api/library` 和 `/api/default-queue`。
- 不自动全量同步网易云。
- 同步只由管理页手动触发，后续定时扩充另开计划实现。

- [ ] **Step 5: Completion criteria**

Only mark this iteration complete when all are true:

- `npm run typecheck` passes.
- Targeted unit tests pass.
- Browser verification passes.
- E2E passes, or the only failure is documented external NetEase service instability.
- Main player, admin page and `/flow` have readable Chinese.
- First screen can play real local liked songs.
- AI recommendation uses DeepSeek or fails loudly.
- AI tag writes `ai:*` and `/flow` shows tag coverage.
- Played songs enter cooldown and are visible in `/flow`.
- No production fake song data is returned.

---

## Automatic Execution Order

Run tasks in this order:

1. Task 0 baseline audit.
2. Task 1 recommendation success and autoplay.
3. Task 2 visible source labels.
4. Task 3 AI tag batch and tag audit.
5. Task 4 full `/flow` visualization.
6. Task 5 Chinese copy and one-screen player polish.
7. Task 6 playback reality verification.
8. Task 7 integrity audit.

If any task fails:

- Stop at the failing task.
- Read the exact test or browser error.
- Fix the root cause with a failing test first.
- Re-run only the focused test.
- Then continue with the next task.

