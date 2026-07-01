"use client";

import { useEffect, useRef, useState } from "react";
import { DataPanel } from "./DataPanel";
import { RecommendationPanel, type RecommendationResponse } from "./RecommendationPanel";
import { StrategyPanel } from "./StrategyPanel";
import { ProfileDiagnosticsPanel } from "@/components/admin/ProfileDiagnosticsPanel";
import { TagQueuePanel } from "@/components/admin/TagQueuePanel";
import type { RecommendationMode, RecommendationScene } from "@/lib/recommendation/types";

const LOGIN_STATUS_POLL_INTERVAL_MS = 1000;

type LoginStatus = "waiting" | "scanned" | "authorized" | "expired";
type LoginState = {
  key: string;
  qrUrl: string;
  status: LoginStatus;
  source?: "cookie" | "qr";
};
type SafeLoginState = {
  provider: "netease";
  status: "active" | "expired" | "missing";
  source?: "cookie" | "qr";
  lastVerifiedAt?: string;
};

type WorkbenchProps = {
  mode?: "player" | "admin";
  silentSyncOnFirstUse?: boolean;
};

type LibraryCounts = {
  songs: number;
  playableSongs?: number;
  imported?: number;
  lastSyncAt?: string | null;
  partialFailures: number;
};

export function Workbench({ mode = "player", silentSyncOnFirstUse = false }: WorkbenchProps) {
  const [prompt, setPrompt] = useState("");
  const [recommendationMode, setRecommendationMode] = useState<RecommendationMode>("balanced");
  const [recommendationScene, setRecommendationScene] = useState<RecommendationScene>("general");
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [loginChecking, setLoginChecking] = useState(true);
  const [cookieText, setCookieText] = useState("");
  const [cookieSaving, setCookieSaving] = useState(false);
  const [cookieEditorOpen, setCookieEditorOpen] = useState(false);
  const [syncCounts, setSyncCounts] = useState<LibraryCounts | null>(null);
  const [syncFailures, setSyncFailures] = useState<string[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [silentSyncLoading, setSilentSyncLoading] = useState(false);
  const [expandLoading, setExpandLoading] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoPlayToken, setAutoPlayToken] = useState(0);
  const [lastRecommendationPrompt, setLastRecommendationPrompt] = useState("");
  const resultRef = useRef<RecommendationResponse | null>(null);
  const silentSyncAttemptedRef = useRef(false);
  const loginAuthorized = login?.status === "authorized" || (login?.source === "cookie" && login.status !== "expired");
  const showAdmin = mode === "admin";
  const showConsumerLogin =
    mode === "player" && silentSyncOnFirstUse && !loginChecking && !loginAuthorized && !result && !silentSyncLoading && (syncCounts?.songs ?? 0) === 0;
  const showConsumerPreparing = mode === "player" && silentSyncOnFirstUse && !result && silentSyncLoading;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const loadQrLogin = (force = false) => fetch(force ? "/api/login/qr?force=1" : "/api/login/qr")
      .then((response) => response.json())
      .then((data: { key: string; qrUrl: string; source?: "cookie" | "qr" }) => {
        if (!active) return;
        setLoginChecking(false);
        setLogin({ ...data, status: data.source === "cookie" ? "authorized" : "waiting" });
        if (data.source === "cookie") return;

        timer = setInterval(() => {
          const statusUrl = `/api/login/status?key=${encodeURIComponent(data.key)}${force ? "&force=1" : ""}`;
          fetch(statusUrl)
            .then((response) => response.json())
            .then((status: { status: LoginStatus; source?: "cookie" | "qr" }) => {
              if (!active) return;
              setLogin((current) => (current ? { ...current, status: status.status, source: status.source ?? current.source } : current));
              if (status.status === "authorized" || status.status === "expired") {
                if (timer) clearInterval(timer);
              }
            })
            .catch(() => undefined);
        }, LOGIN_STATUS_POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (active) {
          setLoginChecking(false);
          setLogin(null);
        }
      });

    const shouldCheckSafeLoginState = mode === "player" && silentSyncOnFirstUse;
    const loginRequest = shouldCheckSafeLoginState
      ? ensureConsumerSession()
          .then(() => fetch("/api/login/state"))
          .then((response) => response.json())
          .then((data: { login?: SafeLoginState | null }) => data.login?.status === "expired")
          .catch(() => false)
          .then((isExpired) => loadQrLogin(isExpired))
      : loadQrLogin(false);

    loginRequest.catch(() => {
      if (active) {
        setLoginChecking(false);
        setLogin(null);
      }
    });

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  async function ensureConsumerSession() {
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }).catch(() => undefined);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/library")
      .then((response) => response.json())
      .then((data: { counts?: LibraryCounts }) => {
        if (!active || !data.counts) return;
        setSyncCounts(data.counts);
        if (mode === "player" && data.counts.songs > 0) {
          void loadDefaultQueue(active);
          return;
        }
        if (mode === "player" && silentSyncOnFirstUse && loginAuthorized && data.counts.songs === 0) {
          void runSilentFirstUseSync(active);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mode, silentSyncOnFirstUse, loginAuthorized]);

  async function loadDefaultQueue(active: boolean) {
    try {
      const response = await fetch("/api/default-queue?limit=12");
      const data = (await response.json()) as RecommendationResponse | { error?: string };
      if (!active || !response.ok || !("items" in data)) return;
      if (resultRef.current) return;
      resultRef.current = data;
      setResult(data);
      setAutoPlayToken((value) => value + 1);
      saveLatestRecommendationResult(data);
      setSyncCounts(data.libraryCounts);
      setSyncFailures(data.strategy.partialFailures ?? []);
    } catch {
      // The empty player remains available for an AI recommendation if the default queue cannot be built.
    }
  }

  async function runSilentFirstUseSync(active: boolean) {
    if (silentSyncAttemptedRef.current) return;
    silentSyncAttemptedRef.current = true;
    setSilentSyncLoading(true);
    try {
      const response = await fetch("/api/sync?mode=quick", { method: "POST" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      if (!active) return;
      setSyncCounts(data.counts);
      if (data.counts.songs > 0) {
        await loadDefaultQueue(active);
      }
    } catch {
      // Keep first-use sync quiet on the C side; users can still request recommendations manually.
    } finally {
      if (active) setSilentSyncLoading(false);
    }
  }

  async function saveCookie() {
    setCookieSaving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/login/cookie", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookie: cookieText })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Cookie 无法保存，请检查后重试。");
        return;
      }
      setCookieText("");
      setCookieEditorOpen(false);
      setSyncCounts(null);
      setSyncFailures([]);
      setResult(null);
      setLogin({
        key: "cookie-login",
        qrUrl: "",
        status: "authorized",
        source: "cookie"
      });
    } finally {
      setCookieSaving(false);
    }
  }

  async function syncLibrary() {
    if (!loginAuthorized) {
      setErrorMessage("请先连接网易云账号。");
      return;
    }
    setSyncLoading(true);
    setErrorMessage(null);
    setSyncFailures([]);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? "同步失败，请稍后重试。");
        return;
      }
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      setSyncCounts(data.counts);
      setSyncFailures(data.partialFailures ?? []);
    } catch {
      setErrorMessage("同步失败，请检查网易云登录状态。");
    } finally {
      setSyncLoading(false);
    }
  }

  async function expandLibrary() {
    if (!loginAuthorized) {
      setErrorMessage("请先连接网易云账号。");
      return;
    }
    setExpandLoading(true);
    setErrorMessage(null);
    setSyncFailures([]);
    try {
      const response = await fetch("/api/expand", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? "扩充曲库失败，请稍后重试。");
        return;
      }
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      setSyncCounts(data.counts);
      setSyncFailures(data.partialFailures ?? []);
    } catch {
      setErrorMessage("扩充曲库失败，请检查网易云登录状态。");
    } finally {
      setExpandLoading(false);
    }
  }

  async function tagLibrary() {
    if (!loginAuthorized) {
      setErrorMessage("请先连接网易云账号，再补充 AI 标签。");
      return;
    }
    setTagLoading(true);
    setErrorMessage(null);
    setSyncFailures([]);
    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 100 })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? "AI 标签补充失败。");
        return;
      }
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      setSyncCounts(data.counts);
      setSyncFailures(data.partialFailures ?? []);
    } catch {
      setErrorMessage("AI 标签补充失败，请检查 DeepSeek 配置。");
    } finally {
      setTagLoading(false);
    }
  }

  async function requestRecommendations(append = false, options?: { mode?: RecommendationMode }) {
    const requestPrompt = append ? lastRecommendationPrompt || result?.flow?.input.prompt || prompt : prompt;
    const requestMode = options?.mode ?? recommendationMode;
    if (!requestPrompt.trim()) {
      setErrorMessage("请先输入听歌场景。");
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const excludeIds = append ? result?.items.map((item) => item.id) ?? [] : [];
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: requestPrompt,
          text: requestPrompt,
          mode: requestMode,
          scene: recommendationScene,
          limit: 12,
          excludeIds
        })
      });
      const data = (await response.json()) as RecommendationResponse | { error?: string };
      if (!response.ok || !("items" in data)) {
        setResult(null);
        setErrorMessage("error" in data && data.error ? data.error : "推荐生成失败，请稍后重试。");
        return;
      }
      const nextResult =
        append && result
          ? {
              ...data,
              items: [...result.items, ...data.items],
              page: data.page
            }
          : data;
      resultRef.current = nextResult;
      setResult(nextResult);
      saveLatestRecommendationResult(nextResult);
      setSyncCounts(data.libraryCounts);
      setSyncFailures(data.strategy.partialFailures ?? []);
      if (!append) {
        setLastRecommendationPrompt(requestPrompt);
        setPrompt("");
        setAutoPlayToken((value) => value + 1);
        if (options?.mode) setRecommendationMode(options.mode);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={showAdmin ? "music-app admin-app" : "music-app player-app"}>
      {showAdmin ? (
        <div className="control-rail">
          <DataPanel
            cookieText={cookieText}
            cookieSaving={cookieSaving}
            login={login}
            loginChecking={loginChecking}
            syncCounts={syncCounts}
            syncFailures={syncFailures}
            syncLoading={syncLoading}
            expandLoading={expandLoading}
            tagLoading={tagLoading}
            canSync={loginAuthorized}
            cookieEditorOpen={cookieEditorOpen}
            onCookieTextChange={setCookieText}
            onSaveCookie={saveCookie}
            onStartCookieReplace={() => setCookieEditorOpen(true)}
            onCancelCookieReplace={() => {
              setCookieEditorOpen(false);
              setCookieText("");
            }}
            onSync={syncLibrary}
            onExpand={expandLibrary}
            onTag={tagLibrary}
          />
          <StrategyPanel result={result} libraryCounts={syncCounts} />
          <ProfileDiagnosticsPanel />
          <TagQueuePanel />
        </div>
      ) : null}
      {showConsumerLogin ? (
        <ConsumerLoginPanel login={login} />
      ) : showConsumerPreparing ? (
        <ConsumerPreparingPanel />
      ) : (
        <RecommendationPanel
          prompt={prompt}
          recommendationMode={recommendationMode}
          recommendationScene={recommendationScene}
          onPromptChange={setPrompt}
          onModeChange={setRecommendationMode}
          onSceneChange={setRecommendationScene}
          onRecommend={(options) => requestRecommendations(false, options)}
          onLoadMore={() => requestRecommendations(true)}
          loading={loading}
          disabledReason={prompt.trim() ? undefined : "prompt"}
          result={result}
          libraryCounts={syncCounts}
          errorMessage={errorMessage}
          autoPlayToken={autoPlayToken}
        />
      )}
    </div>
  );
}

function ConsumerPreparingPanel() {
  return (
    <main className="music-stage">
      <section className="empty-player">
        <div className="vinyl">
          <span className="cover-mark">AI</span>
        </div>
        <div>
          <p className="eyebrow">网易云已连接</p>
          <h3>马上开始听歌</h3>
          <p>已经连接网易云，我正在为你打开第一批歌曲。</p>
        </div>
      </section>
    </main>
  );
}

function ConsumerLoginPanel({ login }: { login: LoginState | null }) {
  const isExpired = login?.status === "expired";
  const isScanned = login?.status === "scanned";

  return (
    <main className="music-stage">
      <section className="empty-player">
        <div className="qr-frame">
          {login?.qrUrl && !isExpired ? <img src={login.qrUrl} alt="网易云扫码登录二维码" /> : <span>二维码暂不可用，请稍后再试</span>}
        </div>
        <div>
          <p className="eyebrow">网易云登录</p>
          <h3>{isExpired ? "登录已过期" : "扫码连接网易云"}</h3>
          <p>{isScanned ? "已经扫码确认，我正在为你打开歌曲。" : "用网易云音乐 App 扫码后，我会在后台准备你的第一批歌曲。"}</p>
          <div className="empty-status-row">
            <span>状态</span>
            <strong>{isExpired ? "重新登录" : isScanned ? "已确认" : "等待扫码"}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}

function saveLatestRecommendationResult(result: RecommendationResponse) {
  try {
    const serialized = JSON.stringify(result);
    window.sessionStorage.setItem("latestRecommendationResult", serialized);
    window.localStorage.setItem("latestRecommendationResult", serialized);
  } catch {
    // Browser storage can be unavailable in private or embedded contexts.
  }
}
