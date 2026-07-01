"use client";

import { RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";

type QueueCounts = {
  pending: number;
  processing: number;
  done: number;
  failed: number;
};

type QueueJob = {
  id: number;
  songId: number;
  reason: string;
  status: keyof QueueCounts;
  attempts: number;
};

type QueueStatus = {
  counts: QueueCounts;
  jobs: QueueJob[];
};

const emptyCounts: QueueCounts = { pending: 0, processing: 0, done: 0, failed: 0 };

export function TagQueuePanel() {
  const [status, setStatus] = useState<QueueStatus>({ counts: emptyCounts, jobs: [] });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processSummary, setProcessSummary] = useState<string | null>(null);

  async function refreshQueue() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tags/queue?limit=8");
      const data = (await response.json()) as QueueStatus | { error?: string };
      if (!response.ok || !("counts" in data)) {
        setError("队列状态读取失败");
        return;
      }
      setStatus(data);
    } catch {
      setError("队列状态读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshQueue();
  }, []);

  async function processQueue() {
    setProcessing(true);
    setError(null);
    setProcessSummary(null);
    try {
      const response = await fetch("/api/tags/queue/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 8 })
      });
      const data = (await response.json()) as { counts?: { processed: number; succeeded: number; failed: number }; error?: string };
      if (!response.ok || !data.counts) {
        setError(data.error ?? "队列处理失败");
        return;
      }
      setProcessSummary(`本次处理 ${data.counts.processed} 首，成功 ${data.counts.succeeded} 首，失败 ${data.counts.failed} 首。`);
      await refreshQueue();
    } catch {
      setError("队列处理失败");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <aside className="tag-queue-panel">
      <div className="panel-header">
        <p className="eyebrow">后台任务</p>
        <h2>AI 打标队列</h2>
      </div>
      <div className="queue-metrics">
        {(["pending", "processing", "done", "failed"] as const).map((key) => (
          <div key={key}>
            <span>{key}</span>
            <strong>{`${key} ${status.counts[key]}`}</strong>
          </div>
        ))}
      </div>
      <div className="queue-action-row">
        <button type="button" className="secondary-button" onClick={() => void refreshQueue()} disabled={loading || processing} title="刷新打标队列">
          <RefreshCcw size={16} />
          {loading ? "刷新中" : "刷新队列"}
        </button>
        <button type="button" className="secondary-button" onClick={() => void processQueue()} disabled={processing || loading || status.counts.pending === 0} title="处理打标队列">
          <RefreshCcw size={16} />
          {processing ? "处理中" : "处理队列"}
        </button>
      </div>
      {error ? <p className="data-note">{error}</p> : null}
      {processSummary ? <p className="data-note">{processSummary}</p> : null}
      {status.jobs.length ? (
        <ul className="queue-job-list">
          {status.jobs.map((job) => (
            <li key={job.id}>
              <span>{`#${job.id} song ${job.songId}`}</span>
              <span className="queue-job-meta">{`attempts ${job.attempts}`}</span>
              <strong>{job.status}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="data-note">暂无队列任务。</p>
      )}
    </aside>
  );
}
