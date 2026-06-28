"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, ExternalLink, Heart, ListMusic, MessageCircle, MoreHorizontal, Pause, Play, Send, Sparkles, ThumbsDown, TimerReset, X } from "lucide-react";
import { findActiveLyricLineIndex, type LyricLine } from "@/lib/lyrics/lyrics";
import { playbackProxyUrl } from "@/lib/playback/url";
import { visibleSongTags } from "@/lib/recommendation/songTags";
import type { RecommendationMode, RecommendationScene } from "@/lib/recommendation/types";
import { RecommendationFlowView } from "./RecommendationFlowView";
import type { RecommendationResponse } from "./recommendationTypes";

export type { RecommendationResponse } from "./recommendationTypes";

type Props = {
  prompt: string;
  recommendationMode?: RecommendationMode;
  recommendationScene?: RecommendationScene;
  onPromptChange: (value: string) => void;
  onModeChange?: (value: RecommendationMode) => void;
  onSceneChange?: (value: RecommendationScene) => void;
  onRecommend: () => void;
  onLoadMore?: () => void;
  loading: boolean;
  disabledReason?: "checking" | "login" | "prompt";
  result: RecommendationResponse | null;
  libraryCounts?: { songs: number; playableSongs?: number; partialFailures: number } | null;
  errorMessage?: string | null;
  autoPlayToken?: number;
};

const modeOptions: Array<{ label: string; value: RecommendationMode }> = [
  { label: "红心熟悉", value: "familiar" },
  { label: "平衡推荐", value: "balanced" },
  { label: "探索新歌", value: "explore" }
];

const sceneOptions: Array<{ label: string; value: RecommendationScene; prompt: string }> = [
  { label: "写代码", value: "work_focus", prompt: "写代码，安静，少人声，别太困" },
  { label: "通勤", value: "commute", prompt: "通勤路上，节奏稳定，心情提起来" },
  { label: "夜晚", value: "night", prompt: "夜晚散步，有一点孤独感，不要太吵" },
  { label: "睡前", value: "sleep", prompt: "睡前听，轻一点，别太抓耳" },
  { label: "运动", value: "workout", prompt: "运动，速度感强，不要太甜" },
  { label: "放松", value: "relax", prompt: "放松一下，温柔但不要太困" }
];

type ChatMessage = {
  id: string;
  role: "user" | "companion";
  text: string;
};

export function RecommendationPanel({
  prompt,
  recommendationMode = "balanced",
  recommendationScene = "general",
  onPromptChange,
  onModeChange = () => undefined,
  onSceneChange = () => undefined,
  onRecommend,
  onLoadMore,
  loading,
  disabledReason,
  result,
  libraryCounts,
  errorMessage,
  autoPlayToken = 0
}: Props) {
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
  const [playerView, setPlayerView] = useState<"cover" | "lyrics">("cover");
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricsSongId, setLyricsSongId] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
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
  const activeLyricIndex = useMemo(() => findActiveLyricLineIndex(lyricLines, boundedCurrentTime), [lyricLines, boundedCurrentTime]);
  const displayLyricIndex = lyricLines.length ? Math.max(0, activeLyricIndex) : -1;
  const lyricWindow = useMemo(() => lyricLinesAround(lyricLines, displayLyricIndex), [lyricLines, displayLyricIndex]);
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
    setPlayerView("cover");
    setLyricLines([]);
    setLyricsSongId(null);
    setLyricsError(null);
    setLyricsLoading(false);
    shouldAutoPlayRef.current = false;
  }, [result]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setPlayerView("cover");
    setLyricLines([]);
    setLyricsSongId(null);
    setLyricsError(null);
    setLyricsLoading(false);
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

  function chooseScene(scene: RecommendationScene, nextPrompt: string) {
    onSceneChange(scene);
    if (!prompt.trim()) onPromptChange(nextPrompt);
  }

  async function showLyrics() {
    setPlayerView("lyrics");
    if (!activeItem) return;
    if (lyricsSongId === activeItem.song.neteaseSongId && lyricLines.length) return;
    setLyricsLoading(true);
    setLyricsError(null);
    try {
      const response = await fetch(`/api/lyrics?id=${encodeURIComponent(activeItem.song.neteaseSongId)}`);
      const data = (await response.json().catch(() => ({}))) as { lines?: LyricLine[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "歌词获取失败");
      }
      setLyricsSongId(activeItem.song.neteaseSongId);
      setLyricLines(Array.isArray(data.lines) ? data.lines : []);
      if (!data.lines?.length) setLyricsError("这首歌暂时没有可同步的歌词。");
    } catch (error) {
      setLyricLines([]);
      setLyricsError(error instanceof Error ? error.message : "歌词获取失败");
    } finally {
      setLyricsLoading(false);
    }
  }

  function openChat() {
    setChatOpen(true);
    if (chatMessages.length || !activeItem) return;
    const line = activeLyricIndex >= 0 ? lyricLines[activeLyricIndex]?.text : null;
    setChatMessages([
      {
        id: "companion-welcome",
        role: "companion",
        text: line ? `我在听这一句：“${line}”。` : `我在，边听《${activeItem.song.name}》边聊。`
      }
    ]);
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text || !activeItem || chatSending) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", text };
    const history = [...chatMessages, userMessage];
    setChatMessages(history);
    setChatDraft("");
    setChatSending(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          song: {
            id: activeItem.song.neteaseSongId,
            name: activeItem.song.name,
            artists: activeItem.song.artistNames,
            album: activeItem.song.albumName,
            tags: activeItem.song.tags
          },
          currentLyricLine: activeLyricIndex >= 0 ? lyricLines[activeLyricIndex] : null,
          playback: {
            currentTime: boundedCurrentTime,
            duration
          },
          history
        })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error ?? "伴听回复失败");
      setChatMessages((current) => [...current, { id: `companion-${Date.now()}`, role: "companion", text: data.message! }]);
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `companion-error-${Date.now()}`,
          role: "companion",
          text: error instanceof Error ? error.message : "伴听回复失败"
        }
      ]);
    } finally {
      setChatSending(false);
    }
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
                <span>{modeLabel(recommendationMode)}</span>
                <strong>{activeItem.song.name}</strong>
              </div>
              <button type="button" className="player-icon-button" onClick={() => setQueueOpen(true)} aria-label="打开播放队列" title="播放队列">
                <ListMusic size={19} />
              </button>
            </header>

            <section className="player-hero" aria-label="当前歌曲">
              {playerView === "lyrics" ? (
                <button type="button" className="lyric-panel" aria-label="切回封面" onClick={() => setPlayerView("cover")}>
                  {lyricsLoading ? <span className="lyric-loading">正在找歌词...</span> : null}
                  {!lyricsLoading && lyricsError ? <span className="lyric-empty">{lyricsError}</span> : null}
                  {!lyricsLoading && !lyricsError && lyricWindow.length ? (
                    <span className="lyric-window">
                      {lyricWindow.map((line) => (
                        <span key={`${line.time}-${line.text}`} className={line.index === displayLyricIndex ? "lyric-line is-active" : "lyric-line"}>
                          <span>{line.text}</span>
                          {line.translation ? <small>{line.translation}</small> : null}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              ) : (
                <button type="button" className="cover-wrap cover-toggle" aria-label="切换到歌词" onClick={() => void showLyrics()}>
                  <span className="cover-glow" style={activeItem.song.coverUrl ? { backgroundImage: `url("${activeItem.song.coverUrl}")` } : undefined} aria-hidden="true" />
                  <span className="cover-art" aria-label={`${activeItem.song.name} 专辑封面`}>
                    {activeItem.song.coverUrl ? <img src={activeItem.song.coverUrl} alt="" /> : <span className="cover-mark">AI</span>}
                  </span>
                  <span className="companion-bubble" onClick={(event) => {
                    event.stopPropagation();
                    openChat();
                  }}>
                    {activeItem.reason}
                  </span>
                </button>
              )}

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
              <button type="button" title="一起听" aria-label="打开一起听" onClick={openChat}>
                <MessageCircle size={21} />
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
            <div className="mode-segment" aria-label="推荐模式">
              {modeOptions.map((option) => (
                <button key={option.value} type="button" className={recommendationMode === option.value ? "is-selected" : undefined} onClick={() => onModeChange(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="shortcut-row scene-shortcuts">
              {sceneOptions.map((option) => (
                <button key={option.value} type="button" className={recommendationScene === option.value ? "is-selected" : undefined} onClick={() => chooseScene(option.value, option.prompt)}>
                  {option.label}
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
      {chatOpen && activeItem ? (
        <div className="chat-overlay" role="dialog" aria-modal="true" aria-label="一起听">
          <section className="chat-page">
            <header className="chat-header">
              <button type="button" className="chat-back" aria-label="返回播放器" onClick={() => setChatOpen(false)}>
                <ArrowLeft size={20} />
              </button>
              <button type="button" className="chat-island" onClick={() => setChatOpen(false)}>
                <span className="chat-island-cover" style={activeItem.song.coverUrl ? { backgroundImage: `url("${activeItem.song.coverUrl}")` } : undefined} />
                <span className="chat-island-copy">
                  <strong>{activeItem.song.name}</strong>
                  <span>{activeItem.song.artistNames.join("、") || "未知歌手"}</span>
                </span>
                <span className="chat-island-progress" style={{ "--timeline-progress": `${progressPercent}%` } as CSSProperties} />
              </button>
            </header>
            <div className="chat-thread">
              {chatMessages.map((message) => (
                <p key={message.id} className={message.role === "user" ? "chat-message is-user" : "chat-message"}>
                  {message.text}
                </p>
              ))}
            </div>
            <form className="chat-compose" onSubmit={sendChatMessage}>
              <input value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder="想聊聊这首吗？" />
              <button type="submit" aria-label="发送" disabled={!chatDraft.trim() || chatSending}>
                <Send size={18} />
              </button>
            </form>
          </section>
        </div>
      ) : null}
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

function modeLabel(mode: RecommendationMode) {
  if (mode === "familiar") return "红心熟悉";
  if (mode === "explore") return "探索新歌";
  return "平衡推荐";
}

function lyricLinesAround(lines: LyricLine[], activeIndex: number) {
  if (!lines.length) return [];
  const fallbackIndex = activeIndex >= 0 ? activeIndex : 0;
  const start = Math.max(0, fallbackIndex - 2);
  const end = Math.min(lines.length, fallbackIndex + 3);
  return lines.slice(start, end).map((line, index) => ({ ...line, index: start + index }));
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
