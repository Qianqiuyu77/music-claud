import type { RecommendationResponse } from "./RecommendationPanel";

export function StrategyPanel({ result, libraryCounts }: { result: RecommendationResponse | null; libraryCounts?: { songs: number; partialFailures: number } | null }) {
  const failureCount = result?.strategy.partialFailures.length ?? libraryCounts?.partialFailures ?? 0;
  const moodTags = result?.context.mood ?? [];
  const syncedSongs = libraryCounts?.songs ?? 0;
  const hasResult = Boolean(result);
  const sourceText = result ? result.strategy.candidateSources.map(sourceLabel).join("、") : null;

  return (
    <aside className="strategy-panel">
      <div className="panel-header">
        <p className="eyebrow">推荐依据</p>
        <h2>本轮来源</h2>
      </div>
      <div className="status-row">
        <span>{hasResult ? "场景" : "状态"}</span>
        <strong>{hasResult ? sceneLabel(result?.context.scene) : syncedSongs > 0 ? "曲库就绪" : "等待同步"}</strong>
      </div>
      {moodTags.length ? (
        <div className="tag-list">
          {moodTags.map((tag) => (
            <span key={tag}>{tagLabel(tag)}</span>
          ))}
        </div>
      ) : (
        <p className="strategy-copy">
          {syncedSongs > 0 ? "输入场景后才会从当前曲库实时挑选，不展示预设歌单。" : "同步网易云曲库后，这里会显示本轮候选来源和匹配标签。"}
        </p>
      )}
      <div className="metric-grid">
        {(hasResult
          ? [
              ["当前场景", sceneLabel(result?.context.scene)],
              ["匹配状态", "持续提供"],
              ["曲库状态", syncedSongs > 0 ? "已就绪" : "未同步"],
              ["推荐来源", sourceText ?? "等待生成"]
            ]
          : [
              ["曲库状态", syncedSongs > 0 ? "已就绪" : "未同步"],
              ["匹配状态", "等待场景"],
              ["推荐来源", "等待生成"],
              ["数据状态", failureCount ? `${failureCount} 条异常` : syncedSongs > 0 ? "就绪" : "等待同步"]
            ]
        ).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="strategy-copy">
        {sourceText
          ? `候选来源：${sourceText}`
          : syncedSongs > 0
            ? "候选来源：生成后显示真实来源"
            : "候选来源：等待真实网易云数据"}
      </p>
      {result?.strategy.partialFailures.length ? (
        <ul className="failure-list">
          {result.strategy.partialFailures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      ) : failureCount ? (
        <p className="failure-copy">有 {failureCount} 条数据没有拉取完整，已跳过问题歌曲。</p>
      ) : null}
    </aside>
  );
}

function sceneLabel(scene?: string) {
  if (scene === "work") return "工作 / 写代码";
  if (!scene) return "等待生成";
  return scene;
}

function tagLabel(tag: string) {
  const labels: Record<string, string> = {
    calm: "安静",
    focused: "专注",
    balanced: "均衡",
    open: "开放"
  };
  return labels[tag] ?? tag;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    liked: "红心相似",
    playlist: "歌单",
    recent: "最近播放",
    dormant: "沉睡好歌",
    exploration: "探索",
    netease_similar_song: "网易云相似歌曲",
    netease_similar_playlist: "网易云相似歌单"
  };
  return labels[source] ?? source;
}
