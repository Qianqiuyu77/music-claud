"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import type { FlowSongSummary, RecommendationAiCall, RecommendationFlow, RecommendationResponse } from "./recommendationTypes";

type RecommendationFlowViewProps = {
  result: RecommendationResponse | null;
  variant?: "dialog" | "page";
  showPageLink?: boolean;
};

type NodeDataRow = {
  label: string;
  value: string;
};

type WorkflowNode = {
  id: string;
  index: number;
  title: string;
  stage: "input" | "api" | "ai" | "library" | "filter" | "rank" | "output";
  status: "done" | "warning" | "empty";
  input: NodeDataRow[];
  action: string;
  output: NodeDataRow[];
  details: string[];
  count?: {
    label: string;
    before?: number;
    after?: number;
    delta?: number;
  };
  relatedAiCalls: RecommendationAiCall[];
};

export function RecommendationFlowView({ result, variant = "dialog", showPageLink = false }: RecommendationFlowViewProps) {
  const flow = result?.flow ?? fallbackFlow(result);
  const aiCalls = flow.ai?.calls ?? [];
  const isPage = variant === "page";

  if (isPage) {
    return <RecommendationWorkflowPageView result={result} flow={flow} aiCalls={aiCalls} />;
  }

  return (
    <section className="flow-view">
      <div className="flow-summary-band">
        <FlowStep title="用户输入" value={flow.input.prompt || "未输入"} meta={`请求 ${flow.input.requested} 首，续播排除 ${flow.input.excludedPlayedIds.length} 首`} />
        <FlowStep
          title="AI 意图解析"
          value={[flow.context.scene, ...(flow.context.mood ?? [])].filter(Boolean).join("、") || "等待解析"}
          meta={`目标 ${formatTags(flow.context.targetTags)} / 排除 ${formatTags(flow.context.excludeTags)}`}
        />
        <FlowStep
          title="候选曲库"
          value={`${flow.library.afterPlayedExclusion} / ${flow.library.totalSongs} 首`}
          meta={`来源：${flow.library.sourceNames.map(sourceLabel).join("、") || "真实曲库"}`}
        />
        <FlowStep
          title="硬过滤"
          value={flow.filters.excludedByTags.length ? `排除 ${flow.filters.excludedByTags.length} 首` : "没有命中排除标签"}
          meta={`规则：${formatTags(flow.filters.excludeTags)}`}
        />
        <FlowStep
          title="AI 重排"
          value={`${flow.ranking.afterTagFilterCount} 首进入 AI，最终 ${flow.ranking.finalCount} 首`}
          meta={`本地候选 ${flow.ranking.localRankedCount} 首`}
        />
      </div>

      {showPageLink ? (
        <Link className="flow-page-link" href="/flow" target="_blank">
          <ExternalLink size={16} />
          打开完整流程页
        </Link>
      ) : null}

      <div className="flow-columns">
        <FlowSongList
          title="被排除"
          songs={flow.filters.excludedByTags.map((song) => ({
            ...song,
            score: 0,
            reason: `命中 ${song.matchedTags.join("、")}`,
            tags: song.matchedTags,
            rank: 0
          }))}
          empty="没有歌曲被硬过滤"
        />
        <FlowSongList title="最终推荐" songs={flow.ranking.final} empty="等待生成推荐" />
      </div>

      <AiRawPanel aiCalls={aiCalls} />
    </section>
  );
}

function RecommendationWorkflowPageView({ result, flow, aiCalls }: { result: RecommendationResponse | null; flow: RecommendationFlow; aiCalls: RecommendationAiCall[] }) {
  const nodes = useMemo(() => buildWorkflowNodes(result, flow), [result, flow]);
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id ?? "input");
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];

  return (
    <section className="flow-view flow-view-page">
      <FlowAuditOverview result={result} flow={flow} />
      <section className="workflow-map" aria-label="数据流节点图">
        <div className="workflow-map-header">
          <div>
            <p className="eyebrow">数据流节点图</p>
            <h2>一次推荐的完整工作流</h2>
          </div>
          <div className="workflow-total">{nodes.length} 个节点</div>
        </div>

        <div className="workflow-layout">
          <div className="workflow-node-rail" role="list" aria-label="推荐流程节点">
            {nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`workflow-node-button is-${node.stage}${selectedNode.id === node.id ? " is-active" : ""}`}
                onClick={() => setSelectedNodeId(node.id)}
                aria-pressed={selectedNode.id === node.id}
              >
                <span className="workflow-node-index">{String(node.index).padStart(2, "0")}</span>
                <span className="workflow-node-copy">
                  <strong>{node.title}</strong>
                  <small>{node.count ? formatNodeCount(node.count) : node.output[0]?.value ?? "已完成"}</small>
                </span>
                <span className={`workflow-node-status is-${node.status}`}>{statusLabel(node.status)}</span>
              </button>
            ))}
          </div>

          {selectedNode ? <WorkflowDetailPanel node={selectedNode} /> : null}
        </div>
      </section>

      <section className="workflow-evidence-grid" aria-label="结果核对">
        <FlowSongList
          title="硬过滤排除"
          songs={flow.filters.excludedByTags.map((song) => ({
            ...song,
            score: 0,
            reason: `命中 ${song.matchedTags.join("、")}`,
            tags: song.matchedTags,
            rank: 0
          }))}
          empty="没有歌曲被硬过滤"
        />
        <CooldownEvidencePanel flow={flow} />
        <FlowTagAuditPanel flow={flow} />
        <FlowSourceAuditPanel result={result} />
        <FlowSongList title="本地候选 Top" songs={flow.ranking.topLocal} empty="没有本地候选记录" />
        <FlowSongList title="最终推荐" songs={flow.ranking.final} empty="等待生成推荐" />
        <FlowContextPanel flow={flow} />
      </section>

      <AiRawPanel aiCalls={aiCalls} />
    </section>
  );
}

function FlowAuditOverview({ result, flow }: { result: RecommendationResponse | null; flow: RecommendationFlow }) {
  const mode = flow.input.mode ?? flow.context.mode ?? result?.context.mode ?? "balanced";
  const modeMix = flow.recall?.modeMix;
  const sourceCounts = flow.recall?.candidateSourceCounts ?? {};
  const aiSelected = flow.ranking.aiSelectedCount ?? result?.items.filter((item) => (item.selectionSource ?? "ai") === "ai").length ?? 0;
  const localFill = flow.ranking.localFillCount ?? result?.items.filter((item) => item.selectionSource === "local_fill").length ?? 0;
  const sourceText = Object.entries(sourceCounts).map(([source, count]) => `${source}: ${count}`);
  return (
    <section className="flow-audit-overview" aria-label="推荐参数总览">
      <div>
        <span>推荐模式</span>
        <strong>{modeLabel(mode)}</strong>
      </div>
      <div>
        <span>场景</span>
        <strong>{flow.input.scene ?? flow.context.scene}</strong>
      </div>
      <div>
        <span>自由文本</span>
        <strong>{flow.input.text ?? (flow.input.prompt || "未输入")}</strong>
      </div>
      <div>
        <span>本地粗排</span>
        <strong>{flow.ranking.localCandidateLimit ? `本地 Top ${flow.ranking.localCandidateLimit}` : `${flow.ranking.localRankedCount} 首`}</strong>
      </div>
      <div>
        <span>AI 精排</span>
        <strong>{flow.ranking.aiTargetCount ? `AI Top ${flow.ranking.aiTargetCount}` : `${flow.ranking.aiRerankedCount} 首`}</strong>
      </div>
      <div>
        <span>AI 候选池</span>
        <strong>{result?.page?.aiPoolSize ? `AI 候选池 ${result.page.aiPoolSize} 首` : "暂无记录"}</strong>
      </div>
      <div>
        <span>最终来源</span>
        <strong>{`AI 选中 ${aiSelected} 首`}</strong>
        <small>{`本地补齐 ${localFill} 首`}</small>
      </div>
      {modeMix ? (
        <div>
          <span>模式比例</span>
          <strong>{`红心 ${formatRatio(modeMix.familiarLibraryRatio)}`}</strong>
          <small>{`相似 ${formatRatio(modeMix.librarySimilarRatio)}`}</small>
          <small>{`扩展 ${formatRatio(modeMix.neteaseExtensionRatio)}`}</small>
        </div>
      ) : null}
      {sourceText.length ? (
        <div>
          <span>来源计数</span>
          <strong>{sourceText[0]}</strong>
          {sourceText.slice(1).map((source) => (
            <small key={source}>{source}</small>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WorkflowDetailPanel({ node }: { node: WorkflowNode }) {
  return (
    <article className={`workflow-detail-panel is-${node.stage}`} role="region" aria-label="当前节点详情">
      <div className="workflow-detail-head">
        <span>{String(node.index).padStart(2, "0")}</span>
        <div>
          <p className="eyebrow">当前节点详情</p>
          <h3>{String(node.index).padStart(2, "0")} {node.title}</h3>
        </div>
      </div>

      {node.count ? (
        <div className="workflow-count">
          <span>{node.count.label}</span>
          <strong>{formatNodeCount(node.count)}</strong>
        </div>
      ) : null}

      <div className="workflow-data-grid">
        <WorkflowDataSection title="节点输入" rows={node.input} />
        <section className="workflow-data-section">
          <h4>处理动作</h4>
          <p>{node.action}</p>
          {node.details.length ? (
            <ul className="workflow-detail-list">
              {node.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
        <WorkflowDataSection title="节点输出" rows={node.output} />
      </div>

      {node.relatedAiCalls.length ? (
        <section className="workflow-ai-snippet" aria-label="当前节点 AI 返回">
          <h4>关联 AI 请求与返回</h4>
          {node.relatedAiCalls.map((call, index) => (
            <div key={call.id || `${node.id}-${index}`} className="workflow-ai-call">
              <div>
                <strong>{call.title || `AI 调用 ${index + 1}`}</strong>
                <span>{[call.model, stageLabel(call.stage)].filter(Boolean).join(" · ")}</span>
              </div>
              <pre>{stringifyJson(call.request)}</pre>
              <pre>{call.rawResponse || "模型没有返回文本"}</pre>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}

function WorkflowDataSection({ title, rows }: { title: string; rows: NodeDataRow[] }) {
  return (
    <section className="workflow-data-section">
      <h4>{title}</h4>
      <dl>
        {rows.map((row) => (
          <div key={`${title}-${row.label}`}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function buildWorkflowNodes(result: RecommendationResponse | null, flow: RecommendationFlow): WorkflowNode[] {
  const items = result?.items ?? [];
  const aiCalls = flow.ai?.calls ?? [];
  const isDefaultLikedQueue = flow.context.scene === "default_liked" || (items.length > 0 && items.every((item) => item.selectionSource === "default_liked"));
  const preferenceCalls = aiCalls.filter((call) => call.stage === "preference");
  const skippedPreferenceCalls = preferenceCalls.filter(isSkippedAiCall);
  const completedPreferenceCalls = preferenceCalls.filter((call) => !isSkippedAiCall(call));
  const intentCalls = aiCalls.filter((call) => call.stage === "intent");
  const taggingCalls = aiCalls.filter((call) => call.stage === "tagging");
  const rerankCalls = aiCalls.filter((call) => call.stage === "rerank");
  const sourceNames = flow.library.sourceNames.map(sourceLabel);
  const playableCount = items.filter((item) => Boolean(item.streamUrl)).length;
  const cooldownExcluded = flow.filters.cooldownExcluded ?? [];
  const storedAiTaggedCount = flow.tags?.aiTaggedSongs ?? items.filter((item) => item.song.tags.includes("ai:tagged") || item.song.tags.includes("ai_tagged")).length;
  const visibleTags = unique([
    ...(flow.context.targetTags ?? []),
    ...(flow.tags?.examples ?? []),
    ...(flow.ranking.final.flatMap((song) => song.tags) ?? []),
    ...items.flatMap((item) => item.song.tags)
  ]).slice(0, 12);
  const excludedNames = flow.filters.excludedByTags.map((song) => `${song.name}${song.artistNames.length ? ` - ${song.artistNames.join("、")}` : ""}`);
  const cooldownNames = cooldownExcluded.map((song) => `${song.name}${song.artistNames.length ? ` - ${song.artistNames.join("、")}` : ""}：${song.reason}`);
  const finalNames = items.length ? items.map((item) => `${item.rank}. ${item.song.name}`).slice(0, 12) : flow.ranking.final.map((song) => `${song.rank}. ${song.name}`).slice(0, 12);

  return [
    {
      id: "input",
      index: 1,
      title: "用户输入",
      stage: "input",
      status: flow.input.prompt ? "done" : "warning",
      input: [{ label: "来源", value: "场景输入弹窗" }],
      action: "把用户的自然语言需求保存为本轮推荐 prompt，并带上续播时需要排除的歌曲 ID。",
      output: [
        { label: "prompt", value: flow.input.prompt || "未输入" },
        { label: "推荐模式", value: modeLabel(flow.input.mode ?? flow.context.mode) },
        { label: "场景", value: flow.input.scene ?? flow.context.scene },
        { label: "自由文本", value: flow.input.text ?? (flow.input.prompt || "未输入") },
        { label: "请求数量", value: `${flow.input.requested} 首` },
        { label: "续播排除", value: `${flow.input.excludedPlayedIds.length} 首` }
      ],
      details: flow.input.excludedPlayedIds.length ? [`排除 ID：${flow.input.excludedPlayedIds.slice(0, 8).join("、")}`] : ["首次推荐或未传入续播排除列表。"],
      relatedAiCalls: []
    },
    {
      id: "request",
      index: 2,
      title: "推荐接口请求",
      stage: "api",
      status: "done",
      input: [
        { label: "接口", value: "POST /api/recommendations" },
        { label: "参数", value: `mode=${flow.input.mode ?? flow.context.mode ?? "balanced"}, scene=${flow.input.scene ?? flow.context.scene}, limit=${flow.input.requested}, excludeIds=${flow.input.excludedPlayedIds.length}` }
      ],
      action: "前端发起推荐请求，后端开始读取本地数据库和 AI 推荐服务。",
      output: [
        { label: "返回数量", value: `${result?.page?.returned ?? items.length} 首` },
        { label: "AI 候选池", value: result?.page?.aiPoolSize ? `AI 候选池 ${result.page.aiPoolSize} 首` : "暂无记录" },
        { label: "是否还有更多", value: result?.page?.hasMore ? "是" : "否" }
      ],
      details: ["请求结果会同时写入 sessionStorage 和 localStorage，供这个流程页读取最近一次推荐。"],
      relatedAiCalls: []
    },
    {
      id: "preference",
      index: 3,
      title: "偏好摘要或跳过",
      stage: "ai",
      status: completedPreferenceCalls.length ? "done" : "warning",
      input: [{ label: "用户画像", value: isDefaultLikedQueue ? "默认我喜欢随机播放不读取画像。" : "当前版本传入空画像，等待后续接入听歌历史和反馈画像。" }],
      action: isDefaultLikedQueue
        ? "默认播放不需要用户画像，已跳过 AI 偏好摘要。"
        : completedPreferenceCalls.length
          ? "调用 AI 生成本轮可用的偏好摘要，作为意图解析的辅助上下文。"
          : "缺少画像，已跳过 AI 偏好摘要；意图解析只基于本次输入和本地规则。",
      output: [{ label: "摘要状态", value: completedPreferenceCalls.length ? "已生成 AI 偏好摘要" : "缺少画像，已跳过" }],
      details: completedPreferenceCalls.length ? ["可以在下方 AI 完整返回中查看偏好摘要原文。"] : ["缺少画像，已跳过。"],
      relatedAiCalls: completedPreferenceCalls.length ? completedPreferenceCalls : skippedPreferenceCalls
    },
    {
      id: "intent",
      index: 4,
      title: "AI 意图解析",
      stage: "ai",
      status: intentCalls.length ? "done" : "warning",
      input: [
        { label: "prompt", value: flow.input.prompt || "未输入" },
        { label: "偏好摘要", value: completedPreferenceCalls.length ? "已传入" : "未传入" }
      ],
      action: isDefaultLikedQueue ? "默认我喜欢随机播放，未调用 AI 意图解析。" : "AI 将自然语言转换为场景、情绪、能量、人声、探索比例、目标标签和排除标签，随后本地规则再补强明显关键词。",
      output: [
        { label: "场景", value: flow.context.scene || "未知" },
        { label: "情绪", value: formatTags(flow.context.mood) },
        { label: "目标标签", value: formatTags(flow.context.targetTags) },
        { label: "排除标签", value: formatTags(flow.context.excludeTags) }
      ],
      details: [
        `能量：${flow.context.energy ?? "未知"}`,
        `人声：${flow.context.vocal ?? "未知"}`,
        `探索比例：${typeof flow.context.exploreRatio === "number" ? `${Math.round(flow.context.exploreRatio * 100)}%` : "未指定"}`
      ],
      relatedAiCalls: isDefaultLikedQueue ? [] : intentCalls
    },
    {
      id: "library",
      index: 5,
      title: "本地曲库读取",
      stage: "library",
      status: flow.library.totalSongs > 0 ? "done" : "empty",
      input: [{ label: "数据源", value: "SQLite 本地数据库里的网易云歌曲" }],
      action: "从数据库读取已同步和已扩充的候选歌曲，不在推荐时重新全量同步网易云。",
      output: [
        { label: "总歌曲", value: `${flow.library.totalSongs} 首` },
        { label: "可播放歌曲", value: `${result?.libraryCounts.playableSongs ?? playableCount} 首` },
        { label: "最近同步", value: result?.libraryCounts.lastSyncAt ? formatTime(result.libraryCounts.lastSyncAt) : "暂无记录" }
      ],
      count: { label: "数据库曲库", before: flow.library.totalSongs, after: flow.library.totalSongs },
      details: ["这个节点读的是本地存储，不会每次推荐都触发网易云同步。"],
      relatedAiCalls: []
    },
    {
      id: "cooldown-filter",
      index: 6,
      title: "播放冷却过滤",
      stage: "filter",
      status: cooldownExcluded.length ? "warning" : "done",
      input: [
        { label: "曲库数量", value: `${flow.library.totalSongs} 首` },
        { label: "播放历史命中", value: `${cooldownExcluded.length} 首` }
      ],
      action: "根据最近播放事件过滤冷却期歌曲：完整播放 7 天内不推荐，听过 30 秒或超过 40% 时 2 天内不推荐。",
      output: [
        { label: "冷却排除", value: `${cooldownExcluded.length} 首` },
        { label: "进入后续候选", value: `${flow.library.afterPlayedExclusion} 首` }
      ],
      count: {
        label: "播放冷却过滤",
        before: flow.library.totalSongs,
        after: flow.library.afterPlayedExclusion,
        delta: flow.library.afterPlayedExclusion - flow.library.totalSongs
      },
      details: cooldownNames.length ? cooldownNames : ["本轮没有歌曲命中播放冷却。"],
      relatedAiCalls: []
    },
    {
      id: "played-exclusion",
      index: 7,
      title: "续播排除",
      stage: "filter",
      status: "done",
      input: [
        { label: "冷却后候选", value: `${flow.library.afterPlayedExclusion} 首` },
        { label: "续播排除 ID", value: `${flow.input.excludedPlayedIds.length} 个` }
      ],
      action: "继续推荐或加载更多时，移除本轮已经返回过的歌曲 ID，避免同一轮队列反复出现。",
      output: [{ label: "剩余候选", value: `${flow.library.afterPlayedExclusion} 首` }],
      count: {
        label: "续播排除",
        before: flow.library.afterPlayedExclusion + flow.input.excludedPlayedIds.length,
        after: flow.library.afterPlayedExclusion,
        delta: -flow.input.excludedPlayedIds.length
      },
      details: flow.input.excludedPlayedIds.length ? [`续播排除 ID：${flow.input.excludedPlayedIds.slice(0, 8).join("、")}`] : ["本轮没有传入续播排除 ID。"],
      relatedAiCalls: []
    },
    {
      id: "source-recall",
      index: 8,
      title: "来源召回",
      stage: "library",
      status: sourceNames.length ? "done" : "warning",
      input: [{ label: "剩余曲库", value: `${flow.library.afterPlayedExclusion} 首` }],
      action: "按候选来源分组召回歌曲，例如红心、歌单、最近播放、沉睡歌曲和网易云相似歌曲扩充结果。",
      output: [
        { label: "来源", value: sourceNames.join("、") || "真实曲库" },
        { label: "模式比例", value: modeMixLabel(flow) },
        { label: "来源计数", value: sourceCountsLabel(flow) },
        { label: "进入排序", value: `${flow.ranking.localRankedCount} 首` }
      ],
      count: { label: "召回数量", before: flow.library.afterPlayedExclusion, after: flow.ranking.localRankedCount },
      details: [`候选来源原始标识：${flow.library.sourceNames.join("、") || "无"}`],
      relatedAiCalls: []
    },
    {
      id: "local-rank",
      index: 9,
      title: "本地排序",
      stage: "rank",
      status: flow.ranking.localRankedCount > 0 ? "done" : "empty",
      input: [
        { label: "召回候选", value: `${flow.ranking.localRankedCount} 首` },
        { label: "目标标签", value: formatTags(flow.context.targetTags) }
      ],
      action: "本地排序先按标签、来源、热度、新鲜度和反馈信号打分，筛出一批可交给 AI 精排的候选。",
      output: [
        { label: "粗排上限", value: flow.ranking.localCandidateLimit ? `本地 Top ${flow.ranking.localCandidateLimit}` : "未记录" },
        { label: "本地候选", value: `${flow.ranking.localRankedCount} 首` },
        { label: "Top 预览", value: formatSongNames(flow.ranking.topLocal) }
      ],
      count: { label: "本地排序", before: flow.library.afterPlayedExclusion, after: flow.ranking.localRankedCount },
      details: flow.ranking.topLocal.length ? flow.ranking.topLocal.slice(0, 5).map((song) => `${song.rank}. ${song.name}，分数 ${song.score}`) : ["本轮没有记录本地 Top 候选。"],
      relatedAiCalls: []
    },
    {
      id: "tag-enrichment",
      index: 10,
      title: "标签增强",
      stage: "ai",
      status: visibleTags.length ? "done" : "warning",
      input: [
        { label: "目标标签", value: formatTags(flow.context.targetTags) },
        { label: "候选歌曲标签", value: visibleTags.length ? visibleTags.join("、") : "暂无标签" }
      ],
      action: taggingCalls.length
        ? "本轮调用 AI 对候选歌曲补充受控标签，再用于过滤和排序。"
        : storedAiTaggedCount
          ? "本轮读取数据库中已保存的 AI 标签，同时合并来源标签和播放可用性标签。"
          : "本轮使用曲库已有标签、来源标签和播放可用性标签，没有现场调用 AI 打标。",
      output: [
        { label: "本轮 AI 打标", value: taggingCalls.length ? `${taggingCalls.length} 次` : "0 次" },
        { label: "AI 已打标歌曲", value: `${storedAiTaggedCount} 首` },
        { label: "AI 标签覆盖率", value: formatPercent(flow.tags?.aiTagCoverage) },
        { label: "可见标签", value: visibleTags.length ? visibleTags.join("、") : "暂无" }
      ],
      details: [
        `标签体系用于匹配目标标签：${formatTags(flow.context.targetTags)}`,
        `标签体系用于排除标签：${formatTags(flow.context.excludeTags)}`
      ],
      relatedAiCalls: taggingCalls
    },
    {
      id: "hard-filter",
      index: 11,
      title: "硬过滤",
      stage: "filter",
      status: flow.filters.excludedByTags.length ? "warning" : "done",
      input: [
        { label: "进入过滤", value: `${flow.ranking.localRankedCount} 首` },
        { label: "排除标签", value: formatTags(flow.filters.excludeTags) }
      ],
      action: "严格移除命中排除标签的歌曲，例如用户说不要太吵时会移除 energy:high。",
      output: [
        { label: "排除结果", value: `排除 ${flow.filters.excludedByTags.length} 首` },
        { label: "过滤后", value: `${flow.ranking.afterTagFilterCount} 首` }
      ],
      count: {
        label: "硬过滤",
        before: flow.ranking.localRankedCount,
        after: flow.ranking.afterTagFilterCount,
        delta: flow.ranking.afterTagFilterCount - flow.ranking.localRankedCount
      },
      details: excludedNames.length ? excludedNames : ["没有歌曲命中硬过滤规则。"],
      relatedAiCalls: []
    },
    {
      id: "ai-rerank",
      index: 12,
      title: "AI 重排",
      stage: "ai",
      status: isDefaultLikedQueue ? "empty" : rerankCalls.length ? "done" : "warning",
      input: [
        { label: "过滤后候选", value: `${flow.ranking.afterTagFilterCount} 首` },
        { label: "目标返回", value: flow.ranking.aiTargetCount ? `AI Top ${flow.ranking.aiTargetCount}` : "50 首 AI 队列" }
      ],
      action: isDefaultLikedQueue
        ? "默认我喜欢随机播放，未调用 AI 重排。"
        : rerankCalls.length
          ? "AI 读取候选歌曲的名称、歌手、专辑、标签、来源和本地分数，重新排序并生成推荐理由。"
          : "本轮没有记录 AI 重排原始返回；如果是场景推荐，这代表 AI 调用失败或结果缺失，需要继续排查。",
      output: [
        { label: "AI 目标", value: flow.ranking.aiTargetCount ? `AI Top ${flow.ranking.aiTargetCount}` : "未记录" },
        { label: "AI 候选池", value: result?.page?.aiPoolSize ? `AI 候选池 ${result.page.aiPoolSize} 首` : "暂无记录" },
        { label: "AI 有效返回", value: `${flow.ranking.aiSelectedCount ?? flow.ranking.aiRerankedCount} 首` },
        { label: "本地补齐", value: `${flow.ranking.localFillCount ?? 0} 首` },
        { label: "推荐理由", value: formatSongReasons(flow.ranking.final) }
      ],
      count: { label: "AI 重排", before: flow.ranking.afterTagFilterCount, after: flow.ranking.aiSelectedCount ?? flow.ranking.aiRerankedCount },
      details: flow.ranking.final.length ? flow.ranking.final.slice(0, 5).map((song) => `${song.name}：${song.reason}`) : ["暂无最终推荐理由。"],
      relatedAiCalls: isDefaultLikedQueue ? [] : rerankCalls
    },
    {
      id: "local-fill",
      index: 13,
      title: "本地补齐",
      stage: "rank",
      status: (flow.ranking.localFillCount ?? 0) > 0 ? "warning" : "done",
      input: [
        { label: "AI 有效返回", value: `${flow.ranking.aiSelectedCount ?? flow.ranking.aiRerankedCount} 首` },
        { label: "期望队列", value: `${flow.input.requested} 首` }
      ],
      action: isDefaultLikedQueue ? "默认我喜欢随机播放，不是本地补齐。" : "当 AI 返回数量不足时，从本地排序候选里补足可播放歌曲，并明确标记为本地补齐，不能伪装成 AI 选中。",
      output: [
        { label: "本地补齐", value: `${flow.ranking.localFillCount ?? 0} 首` },
        { label: "最终数量", value: `${flow.ranking.finalCount} 首` }
      ],
      count: {
        label: "本地补齐",
        before: flow.ranking.aiSelectedCount ?? flow.ranking.aiRerankedCount,
        after: flow.ranking.finalCount,
        delta: flow.ranking.localFillCount ?? 0
      },
      details: items.filter((item) => item.selectionSource === "local_fill").map((item) => `${item.rank}. ${item.song.name}`).slice(0, 8).concat((flow.ranking.localFillCount ?? 0) ? [] : [isDefaultLikedQueue ? "默认我喜欢随机播放，没有本地补齐。" : "本轮没有使用本地补齐。"]),
      relatedAiCalls: []
    },
    {
      id: "playable-queue",
      index: 14,
      title: "可播放队列",
      stage: "output",
      status: playableCount === items.length && items.length > 0 ? "done" : "warning",
      input: [{ label: "最终排序结果", value: `${flow.ranking.finalCount} 首` }],
      action: "后端只把能拿到播放代理地址的歌曲组装进播放器队列，前端播放时走 /api/playback 代理，避免网易云直链过期 403。",
      output: [
        { label: "队列歌曲", value: `${items.length} 首` },
        { label: "可播放", value: `${playableCount} 首` },
        { label: "受限", value: `${Math.max(0, items.length - playableCount)} 首` }
      ],
      count: { label: "可播放队列", before: flow.ranking.aiRerankedCount, after: playableCount },
      details: finalNames.length ? finalNames : ["暂无可播放队列。"],
      relatedAiCalls: []
    },
    {
      id: "final-output",
      index: 15,
      title: "最终输出",
      stage: "output",
      status: items.length ? "done" : "empty",
      input: [
        { label: "播放队列", value: `${items.length} 首` },
        { label: "流程记录", value: aiCalls.length ? `记录 ${aiCalls.length} 次 AI 返回` : "没有 AI 原始返回" }
      ],
      action: "把推荐歌曲、推荐理由、标签、播放代理地址、网易云打开地址和完整 flow 一起返回给前端。",
      output: [
        { label: "页面展示", value: finalNames.join("、") || "暂无推荐" },
        { label: "调试入口", value: "推荐逻辑弹窗与 /flow 完整流程页" }
      ],
      count: { label: "最终输出", before: flow.input.requested, after: items.length },
      details: result?.strategy.partialFailures.length ? result.strategy.partialFailures : ["本轮没有记录部分失败。"],
      relatedAiCalls: []
    }
  ];
}

function FlowStep({ title, value, meta }: { title: string; value: string; meta: string }) {
  return (
    <div className="flow-step">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function FlowSongList({ title, songs, empty }: { title: string; songs: FlowSongSummary[]; empty: string }) {
  return (
    <div className="flow-list">
      <h3>{title}</h3>
      {songs.length ? (
        songs.slice(0, 10).map((song) => (
          <div key={`${title}-${song.id}`} className="flow-song">
            <strong>{song.rank ? `${song.rank}. ${song.name}` : song.name}</strong>
            <span>{song.artistNames.join("、") || "未知歌手"}</span>
            <small>{song.reason}</small>
            <em>{song.tags.slice(0, 5).join("、")}</em>
          </div>
        ))
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

function CooldownEvidencePanel({ flow }: { flow: RecommendationFlow }) {
  const cooldownExcluded = flow.filters.cooldownExcluded ?? [];
  return (
    <div className="flow-list">
      <h3>播放冷却过滤</h3>
      {cooldownExcluded.length ? (
        cooldownExcluded.slice(0, 10).map((song) => (
          <div key={`cooldown-${song.id}`} className="flow-song">
            <strong>{song.name}</strong>
            <span>{song.artistNames.join("、") || "未知歌手"}</span>
            <small>{song.reason}</small>
            <em>{song.cooldownDays} 天冷却</em>
          </div>
        ))
      ) : (
        <p>本轮没有歌曲命中播放冷却。</p>
      )}
    </div>
  );
}

function FlowTagAuditPanel({ flow }: { flow: RecommendationFlow }) {
  const tags = flow.tags;
  return (
    <div className="flow-list flow-context-panel">
      <h3>AI 标签审计</h3>
      <dl>
        <div>
          <dt>AI 已打标歌曲</dt>
          <dd>{tags ? `${tags.aiTaggedSongs} / ${tags.totalSongs} 首` : "暂无记录"}</dd>
        </div>
        <div>
          <dt>AI 标签覆盖率</dt>
          <dd>{formatPercent(tags?.aiTagCoverage)}</dd>
        </div>
        <div>
          <dt>AI tag 示例</dt>
          <dd>{tags?.examples?.length ? tags.examples.join("、") : "暂无"}</dd>
        </div>
      </dl>
    </div>
  );
}

function FlowSourceAuditPanel({ result }: { result: RecommendationResponse | null }) {
  const items = result?.items ?? [];
  const aiSelected = items.filter((item) => (item.selectionSource ?? "ai") === "ai").length;
  const localFill = items.filter((item) => item.selectionSource === "local_fill").length;
  const defaultLiked = items.filter((item) => item.selectionSource === "default_liked").length;
  return (
    <div className="flow-list flow-context-panel">
      <h3>来源统计</h3>
      <dl>
        <div>
          <dt>AI 选中</dt>
          <dd>{aiSelected} 首</dd>
        </div>
        <div>
          <dt>本地补齐</dt>
          <dd>{localFill} 首</dd>
        </div>
        <div>
          <dt>我喜欢随机</dt>
          <dd>{defaultLiked} 首</dd>
        </div>
      </dl>
    </div>
  );
}

function FlowContextPanel({ flow }: { flow: RecommendationFlow }) {
  return (
    <div className="flow-list flow-context-panel">
      <h3>解析上下文</h3>
      <dl>
        <div>
          <dt>场景</dt>
          <dd>{flow.context.scene}</dd>
        </div>
        <div>
          <dt>情绪</dt>
          <dd>{formatTags(flow.context.mood)}</dd>
        </div>
        <div>
          <dt>能量</dt>
          <dd>{flow.context.energy ?? "未知"}</dd>
        </div>
        <div>
          <dt>人声</dt>
          <dd>{flow.context.vocal ?? "未知"}</dd>
        </div>
        <div>
          <dt>探索比例</dt>
          <dd>{typeof flow.context.exploreRatio === "number" ? `${Math.round(flow.context.exploreRatio * 100)}%` : "未指定"}</dd>
        </div>
      </dl>
    </div>
  );
}

function AiRawPanel({ aiCalls }: { aiCalls: RecommendationAiCall[] }) {
  return (
    <section className="ai-raw-panel" aria-label="AI 完整返回">
      <div className="flow-section-heading">
        <p className="eyebrow">AI 完整返回</p>
        <h3>请求输入、模型原文与解析结果</h3>
      </div>
      {aiCalls.length ? (
        <div className="ai-call-list">
          {aiCalls.map((call, index) => (
            <article key={call.id || `${call.stage}-${index}`} className="ai-call-card">
              <div className="ai-call-head">
                <div>
                  <strong>{call.title || `AI 调用 ${index + 1}`}</strong>
                  <span>{[call.model, stageLabel(call.stage)].filter(Boolean).join(" · ") || "DeepSeek 返回"}</span>
                </div>
                <small>{call.createdAt ? formatTime(call.createdAt) : `#${index + 1}`}</small>
              </div>
              <div className="ai-code-grid">
                <CodeBlock title="请求输入" value={stringifyJson(call.request)} />
                <CodeBlock title="原始返回" value={call.rawResponse || "模型没有返回文本"} />
                <CodeBlock title="解析后 JSON" value={stringifyJson(call.parsed)} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="flow-empty-copy">这次推荐没有记录到 AI 原始返回。请重新生成一次推荐。</p>
      )}
    </section>
  );
}

function CodeBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="ai-code-block">
      <span>{title}</span>
      <pre>{value}</pre>
    </div>
  );
}

export function fallbackFlow(result: RecommendationResponse | null): RecommendationFlow {
  const items = result?.items ?? [];
  return {
    input: { prompt: "", requested: result?.page?.requested ?? items.length, excludedPlayedIds: [] },
    context: {
      scene: result?.context.scene ?? "unknown",
      mood: result?.context.mood ?? [],
      novelty: result?.context.novelty ?? "balanced",
      targetTags: [],
      excludeTags: []
    },
    library: {
      totalSongs: result?.libraryCounts.songs ?? 0,
      afterPlayedExclusion: result?.libraryCounts.songs ?? 0,
      sourceNames: result?.strategy.candidateSources ?? []
    },
    filters: { excludeTags: [], excludedByTags: [] },
    ranking: {
      localRankedCount: items.length,
      afterTagFilterCount: items.length,
      aiRerankedCount: items.length,
      finalCount: items.length,
      topLocal: [],
      final: items.map((item) => ({
        id: item.song.neteaseSongId,
        name: item.song.name,
        artistNames: item.song.artistNames,
        score: item.score,
        tags: item.song.tags,
        reason: item.reason,
        rank: item.rank
      }))
    },
    ai: { calls: [] }
  };
}

function formatTags(tags?: string[]) {
  return tags?.length ? tags.join("、") : "无";
}

function formatSongNames(songs: FlowSongSummary[]) {
  return songs.length ? songs.slice(0, 5).map((song) => song.name).join("、") : "暂无";
}

function formatSongReasons(songs: FlowSongSummary[]) {
  return songs.length ? songs.slice(0, 3).map((song) => song.reason).join(" / ") : "暂无";
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "暂无";
  return `${Math.round(value * 100)}%`;
}

function formatRatio(value: number) {
  return `${Math.round(value * 100)}%`;
}

function modeLabel(mode?: string) {
  if (mode === "familiar") return "红心熟悉";
  if (mode === "explore") return "探索新歌";
  if (mode === "balanced") return "平衡推荐";
  return mode ?? "未记录";
}

function modeMixLabel(flow: RecommendationFlow) {
  const mix = flow.recall?.modeMix;
  if (!mix) return "暂无记录";
  return `红心 ${formatRatio(mix.familiarLibraryRatio)} · 相似 ${formatRatio(mix.librarySimilarRatio)} · 扩展 ${formatRatio(mix.neteaseExtensionRatio)}`;
}

function sourceCountsLabel(flow: RecommendationFlow) {
  const counts = flow.recall?.candidateSourceCounts;
  if (!counts || !Object.keys(counts).length) return "暂无记录";
  return Object.entries(counts).map(([source, count]) => `${source}: ${count}`).join(" · ");
}

function formatNodeCount(count: WorkflowNode["count"]) {
  if (!count) return "已完成";
  if (typeof count.before === "number" && typeof count.after === "number") {
    const delta = count.delta ?? count.after - count.before;
    const deltaText = delta === 0 ? "无变化" : `${delta > 0 ? "+" : ""}${delta}`;
    return `${count.before} → ${count.after}（${deltaText}）`;
  }
  if (typeof count.after === "number") return `${count.after}`;
  return "已完成";
}

function statusLabel(status: WorkflowNode["status"]) {
  const labels = {
    done: "完成",
    warning: "注意",
    empty: "为空"
  };
  return labels[status];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stringifyJson(value: unknown) {
  if (value === undefined) return "没有记录";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isSkippedAiCall(call: RecommendationAiCall) {
  const parsed = call.parsed;
  if (parsed && typeof parsed === "object" && "skipped" in parsed) {
    return Boolean((parsed as { skipped?: unknown }).skipped);
  }
  return call.title.includes("跳过");
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    preference: "偏好摘要",
    intent: "意图解析",
    rerank: "推荐重排",
    tagging: "歌曲打标",
    reason: "理由生成"
  };
  return labels[stage] ?? stage;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    liked: "红心",
    playlist: "歌单",
    recent: "最近播放",
    dormant: "沉睡好歌",
    exploration: "探索",
    netease_similar_song: "相似歌曲",
    netease_similar_playlist: "相似歌单"
  };
  return labels[source] ?? source;
}
