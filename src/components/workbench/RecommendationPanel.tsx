"use client";

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink, Heart, ListMusic, MoreHorizontal, Pause, Play, Sparkles, ThumbsDown, TimerReset, X } from "lucide-react";
import { playbackProxyUrl } from "@/lib/playback/url";
import { visibleSongTags } from "@/lib/recommendation/songTags";
import { RecommendationFlowView } from "./RecommendationFlowView";
import type { RecommendationResponse } from "./recommendationTypes";

export type { RecommendationResponse } from "./recommendationTypes";

type Props = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onRecommend: () => void;
  onLoadMore?: () => void;
  loading: boolean;
  disabledReason?: "checking" | "login" | "prompt";
  result: RecommendationResponse | null;
  libraryCounts?: { songs: number; playableSongs?: number; partialFailures: number } | null;
  errorMessage?: string | null;
  autoPlayToken?: number;
};

const shortcuts = [
  ["写代码", "写代码，安静，少人声，别太困"],
  ["夜晚", "夜晚散步，有一点孤独感，不要太吵"],
  ["通勤", "通勤路上，节奏稳定，心情提起来"],
  ["运动", "运动，速度感强，不要太甜"],
  ["探索", "想听点新鲜的，但别偏离太远"],
  ["怀旧", "怀旧一点，适合一个人听"]
];

export function RecommendationPanel({ prompt, onPromptChange, onRecommend, onLoadMore, loading, disabledReason, result, libraryCounts, errorMessage, autoPlayToken = 0 }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldAutoPlayRef = useRef(false);
  const previousFirstIdRef = useRef<string | null>(null);
  const reportedPlaybackRef = useRef<Set<string>>(new Set());
  const [feedbackStatus, setFeedbackStatus] = useState<Record<string, string>>({});
  const [selectedFeedback, setSelectedFeedback] = useState<Record<string, "like" | "dislike" | "too_familiar">>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [sceneDialogOpen, setSceneDialogOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const items = result?.items ?? [];
  const activeItem = items[activeIndex] ?? items[0] ?? null;
  const activePlaybackSrc = activeItem?.streamUrl ? playbackProxyUrl(activeItem.song.neteaseSongId) : null;
  const nextItem = items.length > 1 ? items[(activeIndex + 1) % items.length] : null;
  const isDefaultLikedQueue = result?.context.scene === "default_liked" || (items.length > 0 && items.every((item) => item.selectionSource === "default_liked"));
  const hasMore = !isDefaultLikedQueue && (result?.page?.hasMore ?? true);
  const libraryReady = (libraryCounts?.songs ?? 0) > 0;
  const actionDisabled = loading || Boolean(disabledReason);
  const boundedCurrentTime = duration > 0 ? Math.min(currentTime, duration) : 0;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (boundedCurrentTime / duration) * 100)) : 0;
  const timelineStyle = { "--timeline-progress": `${progressPercent}%` } as CSSProperties;
  const actionLabel = loading
    ? "生成中"
    : disabledReason === "checking"
      ? "等待登录"
      : disabledReason === "login"
        ? "需要登录"
        : disabledReason === "prompt"
          ? "输入场景后生成"
          : "生成推荐";

  useEffect(() => {
    const firstId = result?.items[0]?.id ?? null;
    if (previousFirstIdRef.current === firstId) return;
    previousFirstIdRef.current = firstId;
    setActiveIndex(0);
    setIsPlaying(false);
    setPlaybackNotice(null);
    setCurrentTime(0);
    setDuration(0);
    setQueueOpen(false);
    setFlowOpen(false);
    shouldAutoPlayRef.current = false;
  }, [result]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [activeItem?.id]);

  useEffect(() => {
    if (!onLoadMore || loading || !hasMore || items.length === 0) return;
    if (activeIndex >= Math.max(0, items.length - 3)) onLoadMore();
  }, [activeIndex, hasMore, items.length, loading, onLoadMore]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activePlaybackSrc || !shouldAutoPlayRef.current) return;
    playAudio(audio, setIsPlaying);
  }, [activeIndex, activePlaybackSrc]);

  useEffect(() => {
    if (result?.items.length) setSceneDialogOpen(false);
  }, [result]);

  useEffect(() => {
    if (!autoPlayToken || !activePlaybackSrc) return;
    const audio = audioRef.current;
    if (!audio) return;
    shouldAutoPlayRef.current = true;
    playAudio(audio, setIsPlaying, setPlaybackNotice);
  }, [autoPlayToken, activePlaybackSrc]);

  async function saveFeedback(itemId: string, feedback: "like" | "dislike" | "too_familiar") {
    const label = feedbackLabel(feedback);
    setFeedbackStatus((current) => ({ ...current, [itemId]: "记录中" }));
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, feedback })
      });
      if (!response.ok) throw new Error("feedback failed");
      setSelectedFeedback((current) => ({ ...current, [itemId]: feedback }));
      setFeedbackStatus((current) => ({ ...current, [itemId]: `已记录${label}` }));
    } catch {
      setFeedbackStatus((current) => ({ ...current, [itemId]: "记录失败" }));
    }
  }

  function selectIndex(index: number, autoPlay = true) {
    shouldAutoPlayRef.current = autoPlay || isPlaying || shouldAutoPlayRef.current;
    setActiveIndex((index + items.length) % items.length);
    setCurrentTime(0);
    setDuration(0);
    setQueueOpen(false);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !activePlaybackSrc) return;
    if (audio.paused) {
      shouldAutoPlayRef.current = true;
      setPlaybackNotice(null);
      playAudio(audio, setIsPlaying, setPlaybackNotice);
    } else {
      shouldAutoPlayRef.current = false;
      audio.pause();
      setIsPlaying(false);
    }
  }

  function handlePlaybackError() {
    setPlaybackNotice("播放地址失效，正在换一首。");
    setIsPlaying(false);
    if (items.length > 1) {
      shouldAutoPlayRef.current = true;
      selectIndex(activeIndex + 1);
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    updatePlaybackClock(audio, setCurrentTime, setDuration);
    reportPlaybackIfNeeded(audio);
  }

  function handleLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    updatePlaybackClock(audio, setCurrentTime, setDuration);
  }

  function reportPlaybackIfNeeded(audio: HTMLAudioElement, completed = false) {
    if (!activeItem) return;
    if (reportedPlaybackRef.current.has(activeItem.id)) return;
    const playedSeconds = Number.isFinite(audio.currentTime) ? Math.max(0, Math.floor(audio.currentTime)) : 0;
    const durationSeconds = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.floor(audio.duration) : null;
    const significant = completed || playedSeconds >= 30 || Boolean(durationSeconds && playedSeconds / durationSeconds >= 0.4);
    if (!significant) return;

    reportedPlaybackRef.current.add(activeItem.id);
    void fetch("/api/play-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: activeItem.id,
        playedSeconds,
        durationSeconds,
        completed
      })
    }).catch(() => undefined);
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    const nextTime = Number(event.target.value);
    if (!audio || Number.isNaN(nextTime)) return;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function handleRecommend() {
    if (!actionDisabled) setSceneDialogOpen(false);
    onRecommend();
  }

  return (
    <main className="music-stage">
      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      {activeItem ? (
        <section className="player-shell">
          <div className="player-backdrop" style={activeItem.song.coverUrl ? { backgroundImage: `url("${activeItem.song.coverUrl}")` } : undefined} />
          <div className="player-screen">
            <header className="player-topbar">
              <button type="button" className="player-icon-button" onClick={() => setFlowOpen(true)} aria-label="推荐逻辑" title="推荐逻辑">
                <BarChart3 size={18} />
              </button>
              <div className="now-label">
                <span>{selectionSourceLabel(activeItem.selectionSource)}</span>
                <strong>{activeItem.song.name}</strong>
              </div>
              <button type="button" className="player-icon-button" onClick={() => setQueueOpen(true)} aria-label="打开播放队列" title="播放队列">
                <ListMusic size={19} />
              </button>
            </header>

            <section className="player-hero" aria-label="当前歌曲">
              <div className="cover-wrap">
                <span className="cover-glow" style={activeItem.song.coverUrl ? { backgroundImage: `url("${activeItem.song.coverUrl}")` } : undefined} aria-hidden="true" />
                <span className="cover-art" aria-label={`${activeItem.song.name} 专辑封面`}>
                  {activeItem.song.coverUrl ? <img src={activeItem.song.coverUrl} alt="" /> : <span className="cover-mark">AI</span>}
                </span>
              </div>

              <div className="song-title-block">
                <h1>{activeItem.song.name}</h1>
                <p className="song-meta">
                  {activeItem.song.artistNames.join("、") || "未知歌手"} · {activeItem.song.albumName ?? "未知专辑"}
                </p>
                <SongTagList songName={activeItem.song.name} tags={activeItem.song.tags} />
              </div>
            </section>
          </div>

          <div className="player-dock">
            <p className="reason">
              <span className="source-pill">{selectionSourceLabel(activeItem.selectionSource)}</span>
              <span>{activeItem.reason}</span>
            </p>
            <audio
              ref={audioRef}
              preload="none"
              src={activePlaybackSrc ?? undefined}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onError={handlePlaybackError}
              onEnded={() => {
                const audio = audioRef.current;
                if (audio) reportPlaybackIfNeeded(audio, true);
                shouldAutoPlayRef.current = true;
                setIsPlaying(false);
                if (items.length > 1) selectIndex(activeIndex + 1);
              }}
            />
            {playbackNotice ? <div className="unplayable">{playbackNotice}</div> : null}
            {!activeItem.streamUrl ? <div className="unplayable">{activeItem.song.name} 没有返回可播放地址，可能受版权限制。</div> : null}
            <div className="timeline-row">
              <span>{formatPlaybackTime(boundedCurrentTime)}</span>
              <input
                aria-label="播放进度"
                className="timeline-slider"
                type="range"
                min="0"
                max={duration > 0 ? duration : 0}
                step="1"
                value={boundedCurrentTime}
                style={timelineStyle}
                onChange={handleSeek}
                disabled={!activePlaybackSrc || duration <= 0}
              />
              <span>{duration > 0 ? formatPlaybackTime(duration) : "--:--"}</span>
            </div>
            <div className="transport-bar">
              <button
                type="button"
                title="喜欢"
                aria-label={`标记喜欢 ${activeItem.song.name}`}
                aria-pressed={selectedFeedback[activeItem.id] === "like"}
                className={selectedFeedback[activeItem.id] === "like" ? "is-selected" : undefined}
                onClick={() => void saveFeedback(activeItem.id, "like")}
              >
                <Heart size={21} />
              </button>
              <button type="button" title="上一首" aria-label="上一首" onClick={() => selectIndex(activeIndex - 1)} disabled={items.length < 2}>
                <ChevronLeft size={22} />
              </button>
              <button type="button" className="play-round" title={isPlaying ? "暂停" : "播放"} aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlayback} disabled={!activePlaybackSrc}>
                {isPlaying ? <Pause size={24} /> : <Play size={24} />}
              </button>
              <button type="button" title="下一首" aria-label="下一首" onClick={() => selectIndex(activeIndex + 1)} disabled={items.length < 2}>
                <ChevronRight size={22} />
              </button>
            </div>

            <button type="button" className="listen-request-button" onClick={() => setSceneDialogOpen(true)} aria-label="输入场景">
              <span className="spark-badge">
                <Sparkles size={18} />
              </span>
              <span className="listen-copy">
                <strong>我想听...</strong>
                <span>输入心情或选择一个场景</span>
              </span>
              <MoreHorizontal size={20} />
            </button>

            {nextItem ? (
              <button type="button" className="queue-strip" onClick={() => setQueueOpen(true)} aria-label="查看下一首">
                <span className="mini-cover" style={nextItem.song.coverUrl ? { backgroundImage: `url("${nextItem.song.coverUrl}")` } : undefined} />
                <span className="queue-preview-copy">
                  <strong>{nextItem.song.name}</strong>
                  <span>下一首 · {nextItem.song.artistNames.join("、") || "未知歌手"}</span>
                </span>
                <ChevronRight size={18} />
              </button>
            ) : null}

            <SongActions itemId={activeItem.id} songName={activeItem.song.name} playbackUrl={activeItem.playbackUrl} selectedFeedback={selectedFeedback[activeItem.id]} onFeedback={saveFeedback} compact />
            {feedbackStatus[activeItem.id] ? <p className="feedback-status">{feedbackStatus[activeItem.id]}</p> : null}
          </div>
        </section>
      ) : (
        <section className="empty-player">
          <div className="vinyl">
            <Play size={34} />
          </div>
          <div>
            <p className="eyebrow">{libraryReady ? "曲库已就绪" : "等待曲库同步"}</p>
            <h3>{libraryReady ? "准备好播放了" : "还没有可推荐的真实歌曲"}</h3>
            <p>{libraryReady ? "输入当前场景后，AI 会从本地真实曲库里挑歌，不会临时编造歌单。" : "登录并同步后才会生成推荐，不使用预设歌单。"}</p>
            <div className="empty-status-row">
              <span>真实曲库</span>
              <strong>{libraryReady ? "可播放" : "未就绪"}</strong>
            </div>
            <button type="button" className="empty-scene-button" onClick={() => setSceneDialogOpen(true)}>
              <Sparkles size={18} />
              输入场景
            </button>
          </div>
        </section>
      )}

      {sceneDialogOpen ? (
        <div className="scene-overlay" role="dialog" aria-modal="true" aria-label="场景推荐">
          <div className="scene-dialog">
            <div className="scene-dialog-header">
              <div>
                <p className="eyebrow">AI 场景推荐</p>
                <h2>现在想听什么？</h2>
              </div>
              <button type="button" aria-label="关闭场景推荐" title="关闭" onClick={() => setSceneDialogOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <label className="scene-input">
              <span>听歌场景</span>
              <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="比如：深夜写代码，安静一点，少人声" />
            </label>
            <div className="shortcut-row scene-shortcuts">
              {shortcuts.map(([label, value]) => (
                <button key={label} type="button" onClick={() => onPromptChange(value)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="primary-button scene-submit" onClick={handleRecommend} disabled={actionDisabled}>
              <Sparkles size={18} />
              {actionLabel}
            </button>
          </div>
        </div>
      ) : null}

      {queueOpen ? (
        <div className="queue-overlay" role="dialog" aria-modal="true" aria-label="播放队列">
          <div className="queue-drawer">
            <div className="queue-drawer-header">
              <div>
                <p className="eyebrow">播放队列</p>
                <h2>接下来播放</h2>
              </div>
              <button type="button" aria-label="关闭播放队列" title="关闭" onClick={() => setQueueOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="queue-list">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={index === activeIndex ? "queue-row is-active" : "queue-row"}
                  onClick={() => selectIndex(index)}
                >
                  <span className="queue-title">
                    <strong>{item.song.name}</strong>
                    <span>{item.song.artistNames.join("、") || "未知歌手"}</span>
                  </span>
                  <span className="queue-source">
                    <span>{selectionSourceLabel(item.selectionSource)}</span>
                    <small>{item.streamUrl ? "可播放" : "版权受限"}</small>
                  </span>
                </button>
              ))}
              {loading ? <div className="queue-loading">正在继续推荐...</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {flowOpen ? <RecommendationFlowDialog result={result} onClose={() => setFlowOpen(false)} /> : null}
    </main>
  );
}

function RecommendationFlowDialog({ result, onClose }: { result: RecommendationResponse | null; onClose: () => void }) {
  return (
    <div className="flow-overlay" role="dialog" aria-modal="true" aria-label="推荐逻辑">
      <div className="flow-dialog">
        <div className="flow-header">
          <div>
            <p className="eyebrow">推荐逻辑</p>
            <h2>从输入到歌曲</h2>
          </div>
          <button type="button" aria-label="关闭推荐逻辑" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <RecommendationFlowView result={result} showPageLink />
      </div>
    </div>
  );
}

function playAudio(audio: HTMLAudioElement, setIsPlaying: (value: boolean) => void, setPlaybackNotice?: (value: string | null) => void) {
  try {
    audio.load();
    void Promise.resolve(audio.play())
      .then(() => {
        setPlaybackNotice?.(null);
        setIsPlaying(true);
      })
      .catch(() => {
        setIsPlaying(false);
        setPlaybackNotice?.("播放启动失败，请再点一次或换一首。");
      });
  } catch {
    setIsPlaying(false);
    setPlaybackNotice?.("播放启动失败，请再点一次或换一首。");
  }
}

function updatePlaybackClock(audio: HTMLAudioElement, setCurrentTime: (value: number) => void, setDuration: (value: number) => void) {
  const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
  setCurrentTime(nextTime);
  setDuration(nextDuration);
}

function formatPlaybackTime(value: number) {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const minutes = Math.floor(safeValue / 60);
  const seconds = Math.floor(safeValue % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function selectionSourceLabel(source?: "ai" | "local_fill" | "default_liked") {
  if (source === "local_fill") return "本地补齐";
  if (source === "default_liked") return "我喜欢随机";
  return "AI 选中";
}

function SongTagList({ songName, tags }: { songName: string; tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="song-tag-list" aria-label={`${songName} 分类标签`}>
      {visibleSongTags(tags).map(({ tag, label }) => (
        <span key={tag}>{label}</span>
      ))}
    </div>
  );
}

function SongActions({
  itemId,
  songName,
  playbackUrl,
  selectedFeedback,
  onFeedback,
  compact = false
}: {
  itemId: string;
  songName: string;
  playbackUrl: string;
  selectedFeedback?: "like" | "dislike" | "too_familiar";
  onFeedback: (itemId: string, feedback: "like" | "dislike" | "too_familiar") => Promise<void>;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="song-actions is-compact">
        <a className="open-link" href={playbackUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={16} />
          在网易云打开
        </a>
      </div>
    );
  }

  return (
    <div className="song-actions">
      <a className="open-link" href={playbackUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={16} />
        在网易云打开
      </a>
      <div className="feedback-row">
        <button
          type="button"
          className={selectedFeedback === "like" ? "is-selected" : undefined}
          title="喜欢"
          aria-label={`标记喜欢 ${songName}`}
          aria-pressed={selectedFeedback === "like"}
          onClick={() => void onFeedback(itemId, "like")}
        >
          <Heart size={17} />
        </button>
        <button
          type="button"
          className={selectedFeedback === "dislike" ? "is-selected" : undefined}
          title="不喜欢"
          aria-label={`减少推荐 ${songName}`}
          aria-pressed={selectedFeedback === "dislike"}
          onClick={() => void onFeedback(itemId, "dislike")}
        >
          <ThumbsDown size={17} />
        </button>
        <button
          type="button"
          className={selectedFeedback === "too_familiar" ? "is-selected" : undefined}
          title="太熟了"
          aria-label={`标记太熟 ${songName}`}
          aria-pressed={selectedFeedback === "too_familiar"}
          onClick={() => void onFeedback(itemId, "too_familiar")}
        >
          <TimerReset size={17} />
        </button>
      </div>
    </div>
  );
}

function feedbackLabel(feedback: "like" | "dislike" | "too_familiar") {
  if (feedback === "like") return "喜欢";
  if (feedback === "dislike") return "不喜欢";
  return "太熟";
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
