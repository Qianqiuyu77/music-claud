"use client";

import { useEffect, useRef, useState } from "react";
import { DataPanel } from "./DataPanel";
import { RecommendationPanel, type RecommendationResponse } from "./RecommendationPanel";
import { StrategyPanel } from "./StrategyPanel";
import type { RecommendationMode, RecommendationScene } from "@/lib/recommendation/types";

type LoginStatus = "waiting" | "scanned" | "authorized" | "expired";
type LoginState = {
  key: string;
  qrUrl: string;
  status: LoginStatus;
  source?: "cookie" | "qr";
};

type WorkbenchProps = {
  mode?: "player" | "admin";
};

type LibraryCounts = {
  songs: number;
  playableSongs?: number;
  imported?: number;
  lastSyncAt?: string | null;
  partialFailures: number;
};

export function Workbench({ mode = "player" }: WorkbenchProps) {
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
  const [expandLoading, setExpandLoading] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoPlayToken, setAutoPlayToken] = useState(0);
  const [lastRecommendationPrompt, setLastRecommendationPrompt] = useState("");
  const resultRef = useRef<RecommendationResponse | null>(null);
  const loginAuthorized = login?.status === "authorized" || login?.source === "cookie";
  const showAdmin = mode === "admin";

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    fetch("/api/login/qr")
      .then((response) => response.json())
      .then((data: { key: string; qrUrl: string; source?: "cookie" | "qr" }) => {
        if (!active) return;
        setLoginChecking(false);
        setLogin({ ...data, status: data.source === "cookie" ? "authorized" : "waiting" });
        if (data.source === "cookie") return;

        timer = setInterval(() => {
          fetch(`/api/login/status?key=${encodeURIComponent(data.key)}`)
            .then((response) => response.json())
            .then((status: { status: LoginStatus; encryptedCookie?: string; source?: "cookie" | "qr" }) => {
              if (!active) return;
              setLogin((current) => (current ? { ...current, status: status.status, source: status.source ?? current.source } : current));
              if (status.status === "authorized" || status.status === "expired") {
                if (timer) clearInterval(timer);
              }
            })
            .catch(() => undefined);
        }, 2500);
      })
      .catch(() => {
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

  useEffect(() => {
    let active = true;
    fetch("/api/library")
      .then((response) => response.json())
      .then((data: { counts?: LibraryCounts }) => {
        if (!active || !data.counts) return;
        setSyncCounts(data.counts);
        if (mode === "player" && data.counts.songs > 0) {
          void loadDefaultQueue(active);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mode]);

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
        setErrorMessage(data.error ?? "Cookie 保存失败，请重新复制网易云 Cookie。");
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
      setErrorMessage("请先保存有效的网易云 Cookie，再同步真实曲库。");
      return;
    }
    setSyncLoading(true);
    setErrorMessage(null);
    setSyncFailures([]);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? "同步失败，请检查网易云 Cookie 是否有效。");
        return;
      }
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      setSyncCounts(data.counts);
      setSyncFailures(data.partialFailures ?? []);
    } catch {
      setErrorMessage("同步失败，请检查本地服务和网易云 Cookie 是否有效。");
    } finally {
      setSyncLoading(false);
    }
  }

  async function expandLibrary() {
    if (!loginAuthorized) {
      setErrorMessage("请先保存有效的网易云 Cookie，再扩充真实曲库。");
      return;
    }
    setExpandLoading(true);
    setErrorMessage(null);
    setSyncFailures([]);
    try {
      const response = await fetch("/api/expand", { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? "扩充曲库失败，请稍后再试。");
        return;
      }
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      setSyncCounts(data.counts);
      setSyncFailures(data.partialFailures ?? []);
    } catch {
      setErrorMessage("扩充曲库失败，请检查本地服务和网易云 Cookie 是否有效。");
    } finally {
      setExpandLoading(false);
    }
  }

  async function tagLibrary() {
    if (!loginAuthorized) {
      setErrorMessage("请先保存有效的网易云 Cookie，再补充 AI 标签。");
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
        setErrorMessage(data.error ?? "AI 打标失败，请稍后再试。");
        return;
      }
      const data = (await response.json()) as {
        counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
        partialFailures?: string[];
      };
      setSyncCounts(data.counts);
      setSyncFailures(data.partialFailures ?? []);
    } catch {
      setErrorMessage("AI 打标失败，请检查本地服务和 DeepSeek 配置。");
    } finally {
      setTagLoading(false);
    }
  }

  async function requestRecommendations(append = false) {
    const requestPrompt = append ? lastRecommendationPrompt || result?.flow?.input.prompt || prompt : prompt;
    if (!requestPrompt.trim()) {
      setErrorMessage("请输入当前想听歌的场景。");
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
          mode: recommendationMode,
          scene: recommendationScene,
          limit: 12,
          excludeIds
        })
      });
      const data = (await response.json()) as RecommendationResponse | { error?: string };
      if (!response.ok || !("items" in data)) {
        setResult(null);
        setErrorMessage("error" in data && data.error ? data.error : "推荐生成失败，请稍后再试。");
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
        </div>
      ) : null}
      <RecommendationPanel
        prompt={prompt}
        recommendationMode={recommendationMode}
        recommendationScene={recommendationScene}
        onPromptChange={setPrompt}
        onModeChange={setRecommendationMode}
        onSceneChange={setRecommendationScene}
        onRecommend={() => requestRecommendations(false)}
        onLoadMore={() => requestRecommendations(true)}
        loading={loading}
        disabledReason={prompt.trim() ? undefined : "prompt"}
        result={result}
        libraryCounts={syncCounts}
        errorMessage={errorMessage}
        autoPlayToken={autoPlayToken}
      />
    </div>
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
