"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, QrCode, RefreshCw, Save, ShieldAlert } from "lucide-react";

type Diagnostics = {
  configured: boolean;
  valid: boolean;
  cookiePreview: string;
  account: { userId?: number | string; nickname?: string | null } | null;
  error?: string;
};

type QrState = {
  key: string;
  qrUrl: string;
  source?: "cookie" | "qr";
};

type LoginStatus = {
  status: "waiting" | "scanned" | "authorized" | "expired";
  source?: "cookie" | "qr";
};

const LOGIN_STATUS_POLL_INTERVAL_MS = 1000;

export function CookieTestPanel() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);
  const [qr, setQr] = useState<QrState | null>(null);
  const [qrStatus, setQrStatus] = useState<LoginStatus | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [manualStatus, setManualStatus] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);

  const cookiePreview = useMemo(() => maskCookie(cookieText), [cookieText]);

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  useEffect(() => {
    if (!qr?.key || qr.source === "cookie") return;
    if (qrStatus?.status === "authorized" || qrStatus?.status === "expired") return;

    const timer = setInterval(() => {
      void fetchQrStatus(qr.key, false);
    }, LOGIN_STATUS_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [qr?.key, qr?.source, qrStatus?.status]);

  async function refreshDiagnostics() {
    setDiagnosticsLoading(true);
    try {
      const response = await fetch("/api/login/diagnostics");
      const data = (await response.json()) as Diagnostics;
      setDiagnostics(data);
    } catch {
      setDiagnostics({ configured: false, valid: false, cookiePreview: "", account: null, error: "诊断接口不可用" });
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  async function startQrLogin() {
    setQrLoading(true);
    setQrStatus(null);
    try {
      const response = await fetch("/api/login/qr?force=1");
      const data = (await response.json()) as QrState;
      setQr(data);
      if (data.source === "cookie") {
        setQrStatus({ status: "authorized", source: "cookie" });
      }
    } catch {
      setQr(null);
      setQrStatus({ status: "expired" });
    } finally {
      setQrLoading(false);
    }
  }

  async function checkQrStatus() {
    if (!qr?.key) return;
    await fetchQrStatus(qr.key, true);
  }

  async function fetchQrStatus(key: string, showLoading: boolean) {
    if (showLoading) setStatusLoading(true);
    try {
      const response = await fetch(`/api/login/status?key=${encodeURIComponent(key)}&force=1`);
      const data = (await response.json()) as LoginStatus;
      setQrStatus(data);
    } catch {
      setQrStatus({ status: "waiting" });
    } finally {
      if (showLoading) setStatusLoading(false);
    }
  }

  async function saveManualCookie() {
    setManualSaving(true);
    setManualStatus(null);
    try {
      const response = await fetch("/api/login/cookie", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookie: cookieText })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setManualStatus(data.error ?? "手动 Cookie 保存失败。");
        return;
      }
      setManualStatus("手动 Cookie 已保存。");
      setCookieText("");
      await refreshDiagnostics();
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <main className="cookie-test-shell">
      <header className="cookie-test-header">
        <div>
          <p className="eyebrow">NetEase Cookie Lab</p>
          <h1>网易云 Cookie 获取测试</h1>
          <p>并排验证二维码登录和手动 Cookie 两条路径。默认隐藏敏感内容，只显示可用性和摘要。</p>
        </div>
        <button type="button" onClick={() => void refreshDiagnostics()} disabled={diagnosticsLoading} aria-label="刷新诊断">
          <RefreshCw size={17} />
          刷新诊断
        </button>
      </header>

      <section className="cookie-status-grid">
        <StatusCard label="配置状态" value={diagnosticsLoading ? "检查中" : diagnostics?.configured ? "已配置" : "未配置"} good={Boolean(diagnostics?.configured)} />
        <StatusCard label="校验状态" value={diagnosticsLoading ? "检查中" : diagnostics?.valid ? "可用" : "未通过"} good={Boolean(diagnostics?.valid)} />
        <StatusCard label="Cookie 摘要" value={diagnostics?.cookiePreview || "无"} />
        <StatusCard label="账号" value={formatAccount(diagnostics)} />
      </section>

      {diagnostics?.error ? (
        <div className="cookie-warning">
          <ShieldAlert size={18} />
          <span>{diagnostics.error}</span>
        </div>
      ) : null}

      <div className="cookie-test-grid">
        <section className="cookie-test-card">
          <div className="cookie-card-heading">
            <QrCode size={20} />
            <div>
              <h2>二维码登录</h2>
              <p>验证服务器能否通过扫码流程拿到网易云登录凭据。</p>
            </div>
          </div>
          <div className="qr-test-frame">
            {qr?.qrUrl ? <img src={qr.qrUrl} alt="网易云二维码登录" /> : <span>点击生成二维码开始测试</span>}
          </div>
          <div className="cookie-action-row">
            <button type="button" onClick={() => void startQrLogin()} disabled={qrLoading}>
              <QrCode size={17} />
              {qrLoading ? "生成中" : "生成二维码"}
            </button>
            <button type="button" onClick={() => void checkQrStatus()} disabled={!qr?.key || statusLoading}>
              <RefreshCw size={17} />
              {statusLoading ? "检查中" : "检查扫码状态"}
            </button>
          </div>
          <p className="cookie-test-result">{qrStatusText(qrStatus)}</p>
        </section>

        <section className="cookie-test-card">
          <div className="cookie-card-heading">
            <KeyRound size={20} />
            <div>
              <h2>手动 Cookie</h2>
              <p>验证从浏览器复制的 Cookie 能否保存并被后端使用。</p>
            </div>
          </div>
          <label className="cookie-test-input">
            <span>网易云 Cookie</span>
            <textarea
              aria-label="网易云 Cookie"
              value={cookieText}
              onChange={(event) => setCookieText(event.target.value)}
              placeholder="粘贴 MUSIC_U=... 或 DevTools Cookie 表格"
            />
          </label>
          <div className="cookie-preview-row">
            <span>{cookiePreview || "无输入"}</span>
          </div>
          <button type="button" onClick={() => void saveManualCookie()} disabled={!cookieText.trim() || manualSaving}>
            <Save size={17} />
            {manualSaving ? "保存中" : "保存并校验 Cookie"}
          </button>
          {manualStatus ? <p className="cookie-test-result">{manualStatus}</p> : null}
        </section>
      </div>
    </main>
  );
}

function StatusCard({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="cookie-status-card">
      <span>{label}</span>
      <strong className={good ? "is-good" : undefined}>
        {good ? <CheckCircle2 size={16} /> : null}
        {value}
      </strong>
    </div>
  );
}

function qrStatusText(status: LoginStatus | null) {
  if (!status) return "等待测试。";
  if (status.source === "cookie") return "后端已有 Cookie，二维码流程被跳过。";
  if (status.status === "authorized") return "二维码已授权，接口返回了登录凭据。";
  if (status.status === "scanned") return "已扫码，等待手机确认。";
  if (status.status === "expired") return "二维码已过期或不可用。";
  return "等待扫码。";
}

function formatAccount(diagnostics: Diagnostics | null) {
  if (!diagnostics?.account) return "未知";
  const nickname = diagnostics.account.nickname ?? "未命名";
  return diagnostics.account.userId ? `${nickname} (${diagnostics.account.userId})` : nickname;
}

function maskCookie(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const musicU = trimmed.match(/MUSIC_U=([^;\s]+)/);
  const musicA = trimmed.match(/MUSIC_A=([^;\s]+)/);
  const token = musicU?.[1] ?? musicA?.[1] ?? trimmed;
  const prefix = musicU ? "MUSIC_U" : musicA ? "MUSIC_A" : "Cookie";
  if (token.length <= 8) return `${prefix}=***`;
  return `${prefix}=${token.slice(0, 4)}...${token.slice(-4)}`;
}
