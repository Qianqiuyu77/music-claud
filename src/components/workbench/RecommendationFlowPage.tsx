"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { RecommendationFlowView } from "./RecommendationFlowView";
import type { RecommendationResponse } from "./recommendationTypes";

const STORAGE_KEY = "latestRecommendationResult";

export function RecommendationFlowPage() {
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setResult(readLatestRecommendationResult());
    setLoaded(true);
  }, []);

  return (
    <main className="flow-page-shell">
      <div className="flow-page-backdrop" />
      <header className="flow-page-header">
        <Link href="/" className="flow-back-link">
          <ArrowLeft size={17} />
          返回播放器
        </Link>
        <button type="button" className="flow-refresh-button" onClick={() => setResult(readLatestRecommendationResult())}>
          <RefreshCw size={16} />
          重新读取
        </button>
      </header>

      {result ? (
        <>
          <section className="flow-page-hero">
            <p className="eyebrow">推荐审计台</p>
            <h1>推荐生成流程</h1>
            <p>{result.flow?.input.prompt ? `输入：${result.flow.input.prompt}` : "展示最近一次推荐从用户输入、AI 判断到最终歌曲的完整链路。"}</p>
          </section>
          <RecommendationFlowView result={result} variant="page" />
        </>
      ) : (
        <section className="flow-empty-state">
          <p className="eyebrow">暂无推荐记录</p>
          <h1>{loaded ? "先生成一次推荐" : "正在读取最近推荐"}</h1>
          <p>完整流程页会读取本机最近一次推荐结果，包括 AI 原始返回。回到播放器输入场景并生成推荐后再打开这里。</p>
          <Link href="/" className="flow-back-link is-primary">
            <ArrowLeft size={17} />
            去播放器
          </Link>
        </section>
      )}
    </main>
  );
}

function readLatestRecommendationResult() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecommendationResponse;
    return Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}
