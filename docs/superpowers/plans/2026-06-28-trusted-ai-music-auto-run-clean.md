# 可信 AI 私人音乐系统自动迭代计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行。每个任务必须先写失败测试，再实现，再验证。当前工作区不是 git 仓库时跳过 commit 步骤。

**Goal:** 把当前音乐应用从“能推荐”升级成“可信的 AI 私人音乐系统”：首屏直接播放真实歌曲，推荐必须真实调用 DeepSeek 或明确失败，AI 标签可追踪，播放历史影响后续推荐，所有数据流和 AI 原始输入输出都能在 `/flow` 看清楚。

**Architecture:** SQLite 是本地可信曲库；网易云只负责导入、扩充、歌词和刷新可播放信息；DeepSeek 只负责意图解析、AI 打标和推荐重排。前端播放器永远通过 `/api/playback?id=...` 播放，不直接使用网易云临时 mp3 直链。所有非 AI 结果必须明确标注来源，不能伪装成 AI 推荐。

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite repository layer, Vitest, Playwright, DeepSeek OpenAI-compatible API, NeteaseCloudMusicApiEnhanced, local playback proxy.

---

## 当前状态

已完成并有测试覆盖：

- 推荐成功后清空输入框，并尝试自动播放第一首。
- 首屏默认从本地“我喜欢”随机队列加载，并尝试播放。
- 播放器和队列已显示来源：`AI 选中`、`本地补齐`、`我喜欢随机`。
- 管理页 AI 打标批量已从 8 首改为 100 首。
- 后端 `flow.tags` 已返回 AI 标签覆盖率、已打标数量和示例标签。
- 推荐后端已支持 `selectionSource: "ai" | "local_fill" | "default_liked"`。
- 推荐后端已支持播放冷却基础数据：`flow.filters.cooldownExcluded`。

当前未完成的红灯：

- `/flow` 页面测试已改为期待 15 个节点，但页面仍显示 13 个节点。
- 仍需要全量中文文案修复、类型检查、单测、浏览器播放验证、E2E 和假数据审计。

---

## 文件地图

后端编排：

- 修改：`src/lib/appServices.ts`
  - 确认 AI 推荐失败不能静默兜底。
  - 确认 `flow.tags`、`flow.filters.cooldownExcluded`、`flow.ranking.localFillCount`、`selectionSource` 全部真实返回。
  - 确认默认我喜欢队列没有 AI 调用痕迹。
- 修改：`src/lib/ai/deepseekProvider.ts`
  - 确认重排目标为 50 首，候选最多 300 首。
  - 确认重排不足时重试，仍不足时只返回 AI 实际选中的结果，后端再标记本地补齐。
  - 修复用户可见或 trace 里明显乱码的中文提示。
- 修改：`src/lib/recommendation/songTags.ts`
  - 确认网易云标签、本地标签和 AI `ai:*` 标签都能参与匹配。
  - 确认 AI 标签显示为带 `AI` 前缀的可读中文。
- 修改：`src/app/api/recommendations/route.ts`
  - 确认传入 `requireAi: true`。
  - DeepSeek 不可用时返回清楚错误，不返回伪 AI 推荐。
- 修改：`src/app/api/default-queue/route.ts`
  - 确认只返回 `default_liked`，不调用 AI。
- 修改：`src/app/api/play-events/route.ts`
  - 确认播放 30 秒、超过 40%、或完整播放时写入冷却事件。
- 修改：`src/app/api/tags/route.ts`
  - 确认 `{ limit: 100 }` 生效，AI 打标失败时错误清楚。

前端播放器和流程页：

- 修改：`src/components/workbench/Workbench.tsx`
  - 确认不自动同步网易云，只读 `/api/library` 和 `/api/default-queue`。
  - 确认推荐成功清空输入，失败不清空。
  - 确认推荐成功和默认队列加载都触发自动播放 token。
- 修改：`src/components/workbench/RecommendationPanel.tsx`
  - 确认 `<audio>` 使用 `/api/playback?id=...`。
  - 确认播放事件写入 `/api/play-events`。
  - 确认输入弹窗推荐后关闭、再次打开为空。
  - 确认队列弹窗展示每首歌来源和可播放状态。
- 修改：`src/components/workbench/RecommendationFlowView.tsx`
  - 从 13 节点扩展到 15 节点。
  - 展示冷却过滤、本地补齐、AI 标签覆盖率、来源统计、完整 AI 原始输入输出。
  - 默认我喜欢队列必须显示“未调用 AI”。
- 修改：`src/components/workbench/recommendationTypes.ts`
  - 补齐 `/flow` 新字段类型。
- 修改：`src/components/workbench/DataPanel.tsx`
  - 修复管理页中文文案。
- 修改：`src/components/workbench/StrategyPanel.tsx`
  - 修复策略页中文文案。
- 修改：`src/app/globals.css`
  - 保证主播放页一屏展示，输入和列表进入弹窗或抽屉。

测试：

- 修改：`tests/unit/workbench.test.tsx`
- 修改：`tests/unit/api-contracts.test.ts`
- 修改：`tests/unit/ai-integration.test.ts`
- 修改：`tests/unit/recommendation.test.ts`
- 修改：`tests/unit/song-tags.test.ts`
- 修改：`tests/unit/playback-route.test.ts`
- 修改：`tests/e2e/workbench.spec.ts`

---

## Task 0: 基线确认

**目标：** 确认当前已经完成的能力没有回退，并明确从未完成项继续。

- [ ] **Step 1: 确认工作区是否有 git**

运行：

```bash
git status --short
```

预期：如果提示不是 git 仓库，后续所有 commit 步骤跳过。

- [ ] **Step 2: 跑当前已通过的播放器测试**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx -t "prompt|default liked|source labels|AI tag enrichment"
```

预期：PASS。若失败，先修复回退，不进入新功能。

- [ ] **Step 3: 跑后端基础契约测试**

运行：

```bash
npm test -- tests/unit/api-contracts.test.ts tests/unit/playback-route.test.ts -t "cooldown|default liked|local fill|playback"
```

预期：PASS。若失败，先修复冷却、默认队列、本地补齐或播放事件。

---

## Task 1: 完成 `/flow` 15 节点可视化

**目标：** `/flow` 从 13 节点升级为 15 节点，完整展示用户输入、API 请求、偏好跳过、AI 意图、本地曲库、播放冷却、续播排除、来源召回、本地排序、标签增强、硬过滤、AI 重排、本地补齐、可播放队列、最终输出。

**Files:**

- 修改：`src/components/workbench/RecommendationFlowView.tsx`
- 修改：`src/components/workbench/recommendationTypes.ts`
- 修改：`tests/unit/workbench.test.tsx`

- [ ] **Step 1: 确认红灯测试**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx -t "flow page"
```

预期：FAIL，失败点应包含页面仍显示 `13 个节点` 或缺少以下节点：

```text
06 播放冷却过滤
08 来源召回
10 标签增强
13 本地补齐
14 可播放队列
```

- [ ] **Step 2: 将节点数改为动态**

在 `RecommendationFlowView.tsx` 的页面头部，把固定文案改为：

```tsx
<div className="workflow-total">{nodes.length} 个节点</div>
```

- [ ] **Step 3: 重排 `buildWorkflowNodes` 为 15 个节点**

节点顺序必须是：

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

实现要点：

- 新增 `cooldownExcluded = flow.filters.cooldownExcluded ?? []`。
- 06 节点使用 `cooldownExcluded.length`、歌曲名、歌手、原因、冷却天数。
- 07 节点只展示 `flow.input.excludedPlayedIds` 的续播排除。
- 13 节点使用 `flow.ranking.localFillCount ?? 0`。
- 14 节点统计 `items.filter((item) => item.streamUrl).length`。
- 15 节点展示最终返回数量、AI 调用数量、是否有部分失败。

- [ ] **Step 4: 增加默认我喜欢无 AI 状态**

当 `flow.context.scene === "default_liked"` 或所有 item 的 `selectionSource === "default_liked"` 时：

```text
03 偏好摘要或跳过：默认播放不需要用户画像，已跳过 AI 偏好摘要
04 AI 意图解析：默认我喜欢随机播放，未调用 AI 意图解析
12 AI 重排：默认我喜欢随机播放，未调用 AI 重排
13 本地补齐：默认我喜欢随机播放，不是本地补齐
```

- [ ] **Step 5: 显示 AI 标签覆盖率**

在 `/flow` 的证据区新增或扩展一个面板，展示：

```text
AI 标签覆盖率
AI 已打标歌曲
AI tag 示例
```

覆盖率用 `Math.round(flow.tags.aiTagCoverage * 100)` 格式化为百分比。

- [ ] **Step 6: 显示来源统计**

在 `/flow` 证据区展示：

```text
AI 选中 N 首
本地补齐 N 首
我喜欢随机 N 首
```

统计来源从 `result.items[].selectionSource` 计算，不能从文案猜。

- [ ] **Step 7: 验证**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx -t "flow"
```

预期：PASS。

---

## Task 2: 确认 AI 推荐真实调用和完整队列逻辑

**目标：** 用户输入后的推荐必须真实调用 DeepSeek。AI 只返回 6 首时，剩余歌曲只能标成 `本地补齐`，不能冒充 AI。DeepSeek 不可用时推荐接口失败，而不是静默兜底。

**Files:**

- 修改：`src/lib/appServices.ts`
- 修改：`src/lib/ai/deepseekProvider.ts`
- 修改：`src/app/api/recommendations/route.ts`
- 修改：`tests/unit/api-contracts.test.ts`
- 修改：`tests/unit/ai-integration.test.ts`

- [ ] **Step 1: 跑已有 AI 队列测试**

运行：

```bash
npm test -- tests/unit/ai-integration.test.ts -t "50-song queue|retries"
```

预期：PASS。若失败，修复 `DeepSeekProvider.rerankRecommendations`。

- [ ] **Step 2: 增加或确认 requireAi 测试**

`tests/unit/api-contracts.test.ts` 必须覆盖：

```ts
await expect(
  createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true })
).rejects.toThrow(/DeepSeek|AI/);
```

前提：测试环境没有注入 aiProvider 且没有 `DEEPSEEK_API_KEY`。

- [ ] **Step 3: 确认推荐接口强制 AI**

`src/app/api/recommendations/route.ts` 必须调用：

```ts
await createRecommendationResponse(prompt, undefined, {
  limit,
  excludeIds,
  requireAi: true
});
```

- [ ] **Step 4: 确认本地补齐标识**

`src/lib/appServices.ts` 的 `fillRecommendations` 必须满足：

```ts
result.push({ ...item, selectionSource: item.selectionSource ?? "ai" });
```

只用于 AI 返回的 primary。

```ts
result.push({ ...item, selectionSource: item.selectionSource ?? "local_fill" });
```

只用于 fallback 补齐。

- [ ] **Step 5: 验证本地补齐 flow**

运行：

```bash
npm test -- tests/unit/api-contracts.test.ts -t "local fill|requireAi|DeepSeek"
```

预期：PASS，并且断言：

```ts
expect(response.flow.ranking.localFillCount).toBeGreaterThan(0);
expect(response.flow.ranking.final.some((song) => song.selectionSource === "local_fill")).toBe(true);
```

---

## Task 3: AI 打标闭环

**目标：** AI 必须参与打 tag。网易云标签、本地标签可以作为输入，但 AI 输出必须统一保存为 `ai:*`，并用 `ai:tagged` 标记已处理。

**Files:**

- 修改：`src/lib/ai/deepseekProvider.ts`
- 修改：`src/lib/ai/tagTaxonomy.ts`
- 修改：`src/lib/recommendation/songTags.ts`
- 修改：`src/lib/appServices.ts`
- 修改：`tests/unit/ai-integration.test.ts`
- 修改：`tests/unit/song-tags.test.ts`
- 修改：`tests/unit/api-contracts.test.ts`
- 修改：`tests/unit/workbench.test.tsx`

- [ ] **Step 1: 跑 AI 打标测试**

运行：

```bash
npm test -- tests/unit/ai-integration.test.ts -t "tag songs|AI tagging|id-mapped"
```

预期：PASS。若失败，修复 DeepSeek tag 响应解析和 `namespaceAiTags`。

- [ ] **Step 2: 确认 `ai:*` 保存**

AI 返回：

```json
{ "id": "101", "tags": ["scene:focus", "mood:calm"] }
```

入库后必须包含：

```text
ai:scene:focus
ai:mood:calm
ai:tagged
```

并且不再新增旧格式 `ai_tagged`。

- [ ] **Step 3: 确认匹配兼容**

`rankCandidates` 必须让 `scene:focus` 可以匹配歌曲标签 `ai:scene:focus`。

运行：

```bash
npm test -- tests/unit/recommendation.test.ts -t "ai-prefixed"
```

预期：PASS。

- [ ] **Step 4: 确认 UI 显示 AI 标签**

运行：

```bash
npm test -- tests/unit/song-tags.test.ts -t "AI label|visible"
```

预期：PASS，`ai:mood:calm` 显示为 `AI 安静` 这类可读中文。

- [ ] **Step 5: 确认 `/flow` 标签审计**

运行：

```bash
npm test -- tests/unit/api-contracts.test.ts -t "tag audit|AI tag"
npm test -- tests/unit/workbench.test.tsx -t "flow"
```

预期：PASS，`/flow` 能看到 AI 标签覆盖率。

---

## Task 4: 播放历史与冷却期

**目标：** 播放过的歌曲短期不重复推荐。完整播放 7 天冷却，听过 30 秒或超过 40% 则 2 天冷却，不喜欢长期强降权或排除。

**Files:**

- 修改：`src/components/workbench/RecommendationPanel.tsx`
- 修改：`src/app/api/play-events/route.ts`
- 修改：`src/lib/appServices.ts`
- 修改：`src/lib/repositories/musicRepository.ts`
- 修改：`tests/unit/playback-route.test.ts`
- 修改：`tests/unit/api-contracts.test.ts`
- 修改：`tests/unit/workbench.test.tsx`

- [ ] **Step 1: 确认播放事件写入测试**

运行：

```bash
npm test -- tests/unit/playback-route.test.ts -t "play-events|playback"
```

预期：PASS。

- [ ] **Step 2: 确认前端触发阈值**

`RecommendationPanel.tsx` 必须在以下任一条件满足时 POST `/api/play-events`：

```ts
playedSeconds >= 30
playedSeconds / durationSeconds >= 0.4
completed === true
```

同一首歌一次播放会话不要重复刷爆接口。

- [ ] **Step 3: 确认推荐过滤冷却歌曲**

`createRecommendationResponse` 和 `createDefaultLikedQueueResponse` 都必须调用 `collectCooldownExcluded`，并从候选中过滤这些歌曲。

- [ ] **Step 4: 确认 `/flow` 展示冷却详情**

`/flow` 必须显示每首冷却歌曲：

```text
歌名
歌手
完整播放 7 天冷却 / 已听过 2 天冷却
cooldownDays
```

- [ ] **Step 5: 验证**

运行：

```bash
npm test -- tests/unit/api-contracts.test.ts -t "cooldown"
npm test -- tests/unit/workbench.test.tsx -t "flow"
```

预期：PASS。

---

## Task 5: 首屏和推荐后的播放体验

**目标：** 用户第一次进入不再等 AI。页面直接从本地我喜欢随机队列开始。用户输入推荐成功后，清空输入框并自动播放第一首；失败时保留输入框。

**Files:**

- 修改：`src/components/workbench/Workbench.tsx`
- 修改：`src/components/workbench/RecommendationPanel.tsx`
- 修改：`tests/unit/workbench.test.tsx`

- [ ] **Step 1: 验证默认队列不调推荐接口**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx -t "default liked"
```

预期：PASS，并且测试断言没有请求 `/api/recommendations`。

- [ ] **Step 2: 验证成功清空输入并自动播放**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx -t "clears the prompt"
```

预期：PASS，`HTMLMediaElement.prototype.play` 被调用。

- [ ] **Step 3: 验证失败保留输入**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx -t "keeps the prompt"
```

预期：PASS。

- [ ] **Step 4: 浏览器验证**

打开：

```text
http://127.0.0.1:3000/
```

验证：

```text
进入页面后显示真实歌曲，而不是空等 AI。
默认队列标注“我喜欢随机”，不是“AI 选中”。
点击输入按钮后才出现输入框。
推荐成功后输入框清空。
推荐成功后切到第一首并尝试播放。
浏览器拦截自动播放时，页面给出可理解提示。
```

---

## Task 6: 播放真实可用性

**目标：** 音乐必须可播放，前端不能拿网易云临时 mp3 直链当 `<audio src>`，避免 403。

**Files:**

- 修改：`src/components/workbench/RecommendationPanel.tsx`
- 修改：`src/lib/playback/url.ts`
- 修改：`src/lib/playback/playbackService.ts`
- 修改：`src/app/api/playback/route.ts`
- 修改：`tests/unit/playback-route.test.ts`
- 修改：`tests/e2e/workbench.spec.ts`

- [ ] **Step 1: 审计前端播放 URL**

运行：

```bash
rg "m701.music.126.net|m7.music.126.net|streamUrl" src/components src/lib
```

预期：

```text
前端播放器不能把网易云临时 mp3 直链放进 audio src。
允许后端 playback service 内部获取真实地址。
允许类型或测试里存在 streamUrl 字段。
```

- [ ] **Step 2: 确认 `<audio>` 使用代理**

`RecommendationPanel.tsx` 中当前播放地址必须来自：

```ts
item.streamUrl ?? item.playbackUrl
```

其中 API 返回的 `streamUrl` 必须是：

```ts
playbackProxyUrl(item.song.neteaseSongId)
```

格式为：

```text
/api/playback?id=<neteaseSongId>
```

- [ ] **Step 3: 播放路由测试**

运行：

```bash
npm test -- tests/unit/playback-route.test.ts
```

预期：PASS。

- [ ] **Step 4: 浏览器网络验证**

打开播放器后验证 Network：

```text
audio 请求是 /api/playback?id=...
没有由浏览器直接 GET http://m701.music.126.net/...mp3
如果网易云返回 403，页面显示清楚错误并尝试换歌，不能假装播放成功。
```

---

## Task 7: 全量中文文案修复

**目标：** 所有用户可见 UI 和 API 错误都是可读中文，不能再出现乱码中文或英文占位。

**Files:**

- 修改：`src/components/workbench/Workbench.tsx`
- 修改：`src/components/workbench/RecommendationPanel.tsx`
- 修改：`src/components/workbench/RecommendationFlowView.tsx`
- 修改：`src/components/workbench/DataPanel.tsx`
- 修改：`src/components/workbench/StrategyPanel.tsx`
- 修改：`src/lib/appServices.ts`
- 修改：`src/lib/ai/deepseekProvider.ts`
- 修改：`src/app/api/**/*.ts`
- 修改：`tests/unit/*.test.ts*`

- [ ] **Step 1: 扫描明显乱码**

运行：

```bash
rg "銆|鈥|涓|绋|娴|妫|閿|鐢|瀹|鏈|杈|棰" src/components src/lib src/app tests/unit
```

说明：这条命令会有误报。只修复用户可见文案、AI trace 标题、API 错误、测试断言。不要为了清理测试 fixture 大改无关逻辑。

- [ ] **Step 2: 核心播放器文案**

播放器至少应使用这些可读中文：

```text
正在播放
播放队列
推荐逻辑
当前歌曲
未知歌手
未知专辑
播放地址失效，正在换一首。
播放启动失败，请再点一次或换一首。
输入场景
听歌场景
生成推荐
正在生成
打开完整流程页
AI 选中
本地补齐
我喜欢随机
可播放
版权受限
```

- [ ] **Step 3: 管理页文案**

管理页至少应使用这些可读中文：

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

- [ ] **Step 4: 流程页文案**

流程页至少应使用这些可读中文：

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
播放冷却过滤
本地补齐
AI 标签覆盖率
```

- [ ] **Step 5: 验证**

运行：

```bash
npm test -- tests/unit/workbench.test.tsx
```

预期：PASS，测试断言也改成可读中文。

---

## Task 8: 主界面一屏沉浸式播放器

**目标：** 主界面只占满一个屏幕，常驻区域是播放器。输入框、队列、流程说明进入按钮触发的弹窗或抽屉。PC 和移动端都不能出现明显重叠或挤压。

**Files:**

- 修改：`src/components/workbench/Workbench.tsx`
- 修改：`src/components/workbench/RecommendationPanel.tsx`
- 修改：`src/app/globals.css`
- 修改：`tests/e2e/workbench.spec.ts`

- [ ] **Step 1: CSS 约束一屏**

确认或补充：

```css
.music-app.player-app {
  min-height: 100dvh;
  height: 100dvh;
  overflow: hidden;
}

.music-stage {
  min-height: 0;
  height: 100%;
}
```

弹窗、队列抽屉、流程面板内部可以滚动，但主页面不应整体滚动。

- [ ] **Step 2: 输入框不常驻**

主界面只显示“输入场景”按钮。点击后打开 `dialog`，输入 prompt 并生成推荐。

- [ ] **Step 3: 队列不占主区域**

歌曲列表通过“播放队列”按钮打开，不占据主播放区大面积空间。

- [ ] **Step 4: 响应式截图验证**

用浏览器分别验证：

```text
desktop: 1440x900
mobile: 390x844
```

检查：

```text
播放器主体没有溢出屏幕。
歌词逐行滚动不挡控制按钮。
输入弹窗不被底部控制条遮挡。
队列抽屉可滚动。
按钮文字不溢出。
```

---

## Task 9: 运行完整验证

**目标：** 在标记完成前，用测试和浏览器证明功能真实可用。

- [ ] **Step 1: 类型检查**

运行：

```bash
npm run typecheck
```

预期：PASS。

- [ ] **Step 2: 目标单测**

运行：

```bash
npm test -- tests/unit/api-contracts.test.ts tests/unit/ai-integration.test.ts tests/unit/recommendation.test.ts tests/unit/song-tags.test.ts tests/unit/playback-route.test.ts tests/unit/workbench.test.tsx
```

预期：PASS。

- [ ] **Step 3: 启动项目**

运行：

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:3000/
```

- [ ] **Step 4: 浏览器手工验收**

必须验证：

```text
首屏直接展示本地我喜欢随机队列。
首屏不是空等 AI。
默认队列来源显示“我喜欢随机”。
输入场景推荐会调用 /api/recommendations。
DeepSeek 失败时页面显示错误，不伪装成功。
推荐成功后输入框清空。
推荐成功后自动切到第一首并尝试播放。
audio src 是 /api/playback?id=...。
播放 30 秒或超过 40% 后 POST /api/play-events。
/flow 有 15 个节点。
/flow 能看到 AI 原始请求、原始返回、解析 JSON。
/flow 能看到 AI 实际返回数量、本地补齐数量、来源统计。
/flow 能看到 AI 标签覆盖率。
/flow 能看到播放冷却过滤详情。
移动端和 PC 端页面都保持一屏主播放器体验。
```

- [ ] **Step 5: E2E**

运行：

```bash
npm test:e2e
```

预期：PASS。若唯一失败来自网易云外部服务临时不可用，必须记录具体请求、HTTP 状态码和页面错误提示，不能把失败包装为成功。

---

## Task 10: 可信度审计

**目标：** 防止 mock、假数据、过期播放直链、静默兜底再次混入生产路径。

- [ ] **Step 1: 假数据审计**

运行：

```bash
rg "music.example|placeholder|fake|mock|fixture|测试歌曲|预设歌单" src
```

预期：

```text
src 生产路径不能返回测试歌曲、假媒体地址、假推荐歌单。
测试数据只能存在 tests。
```

- [ ] **Step 2: AI 兜底审计**

运行：

```bash
rg "allowFallback|requireAi|local_fill|default_liked|FallbackAiProvider|DeepSeek" src/lib src/app src/components
```

预期：

```text
/api/recommendations 使用 requireAi: true。
DeepSeek 缺失或失败时推荐接口明确失败。
local_fill 只显示为本地补齐。
default_liked 只显示为我喜欢随机。
没有任何本地排序伪装成 AI 推荐。
```

- [ ] **Step 3: 播放 URL 审计**

运行：

```bash
rg "m701.music.126.net|m7.music.126.net|streamUrl" src/components src/lib
```

预期：

```text
前端播放器使用 /api/playback?id=...。
不把网易云临时 mp3 直链作为 audio src。
```

- [ ] **Step 4: 同步行为审计**

运行：

```bash
rg "/api/sync|/api/default-queue|/api/recommendations" src/components tests/unit/workbench.test.tsx
```

预期：

```text
进入播放器只读 /api/library 和 /api/default-queue。
不会自动全量同步网易云。
同步只在管理页手动触发。
定时扩充曲库另开计划，不混在本轮完成标准里。
```

---

## 完成标准

只有全部满足后，才能把目标标记为完成：

- `npm run typecheck` 通过。
- 目标单测全部通过。
- `/flow` 显示 15 个节点。
- `/flow` 显示 AI 原始输入、原始返回、解析 JSON。
- `/flow` 显示 AI 标签覆盖率、播放冷却、本地补齐和来源统计。
- 首屏能从本地我喜欢随机队列展示真实歌曲。
- 推荐成功清空输入并尝试自动播放。
- DeepSeek 不可用时推荐失败，不静默兜底。
- AI 打标写入 `ai:*` 和 `ai:tagged`。
- 播放事件写入后，冷却期歌曲不会继续推荐。
- 前端 `<audio>` 不直连网易云临时 mp3。
- 生产路径没有 mock 歌曲、假媒体地址或预设推荐歌单。
- 主播放器 PC 和移动端都保持一屏沉浸式体验。
- 用户可见文案都是可读中文。

---

## 自动执行顺序

1. Task 0：基线确认。
2. Task 1：完成 `/flow` 15 节点可视化。
3. Task 2：确认 AI 推荐真实调用和完整队列逻辑。
4. Task 3：AI 打标闭环。
5. Task 4：播放历史与冷却期。
6. Task 5：首屏和推荐后的播放体验。
7. Task 6：播放真实可用性。
8. Task 7：全量中文文案修复。
9. Task 8：主界面一屏沉浸式播放器。
10. Task 9：运行完整验证。
11. Task 10：可信度审计。

若任一任务失败：

1. 停在失败任务。
2. 读取精确测试或浏览器错误。
3. 先补失败测试或扩大现有测试断言。
4. 修根因，不做表面兜底。
5. 只重跑聚焦测试。
6. 通过后继续下一任务。
