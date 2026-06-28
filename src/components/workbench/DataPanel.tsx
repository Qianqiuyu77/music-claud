import { RefreshCcw, Save } from "lucide-react";

type LoginState = {
  key: string;
  qrUrl: string;
  status: "waiting" | "scanned" | "authorized" | "expired";
  source?: "cookie" | "qr";
};

type DataPanelProps = {
  cookieText: string;
  cookieSaving: boolean;
  login: LoginState | null;
  loginChecking: boolean;
  syncCounts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number } | null;
  syncFailures: string[];
  syncLoading: boolean;
  expandLoading: boolean;
  tagLoading: boolean;
  canSync: boolean;
  cookieEditorOpen: boolean;
  onCookieTextChange: (value: string) => void;
  onSaveCookie: () => void;
  onStartCookieReplace: () => void;
  onCancelCookieReplace: () => void;
  onSync: () => void;
  onExpand: () => void;
  onTag: () => void;
};

export function DataPanel({
  cookieText,
  cookieSaving,
  login,
  loginChecking,
  syncCounts,
  syncFailures,
  syncLoading,
  expandLoading,
  tagLoading,
  canSync,
  cookieEditorOpen,
  onCookieTextChange,
  onSaveCookie,
  onStartCookieReplace,
  onCancelCookieReplace,
  onSync,
  onExpand,
  onTag
}: DataPanelProps) {
  const syncButtonLabel = syncLoading ? "正在同步" : canSync ? "同步网易云数据" : "登录后同步";
  const expandButtonLabel = expandLoading ? "正在扩充" : canSync ? "扩充曲库" : "登录后扩充";
  const tagButtonLabel = tagLoading ? "正在打标" : canSync ? "补充 AI 标签" : "登录后打标";
  const showCookieEditor = !loginChecking && (login?.source !== "cookie" || cookieEditorOpen);
  const hasSyncFailures = (syncCounts?.partialFailures ?? 0) > 0 || syncFailures.length > 0;

  return (
    <aside className="music-sidebar">
      <div className="brand-block">
        <div className="brand-mark">音</div>
        <div>
          <p className="eyebrow">本地推荐台</p>
          <h1>AI 私人歌单</h1>
        </div>
      </div>

      <section className="login-card">
        <div className="panel-header">
          <p className="eyebrow">网易云音乐</p>
          <h2>{loginChecking ? "正在连接" : login?.source === "cookie" ? "网易云已连接" : "网易云登录"}</h2>
        </div>
        {loginChecking ? (
          <div className="cookie-ready">
            <strong>正在确认登录状态</strong>
            <span>连接确认前不会展示登录输入，也不会生成推荐。</span>
          </div>
        ) : login?.source === "cookie" ? (
          <div className="cookie-ready">
            <strong>账号已就绪</strong>
            <span>不在页面展示登录凭据。需要换号时再粘贴新的登录信息。</span>
          </div>
        ) : (
          <div className="qr-frame">
            {login?.qrUrl ? <img src={login.qrUrl} alt="网易云扫码登录二维码" /> : <span>扫码暂不可用，请改用登录信息导入。</span>}
          </div>
        )}
        <p className="login-copy">{loginChecking ? "正在读取本地后端登录状态。" : statusText(login)}</p>
        {!loginChecking && login?.source === "cookie" && !cookieEditorOpen ? (
          <button type="button" className="secondary-button" onClick={onStartCookieReplace} title="更换账号">
            更换账号
          </button>
        ) : null}
        {showCookieEditor ? (
          <>
            <label className="cookie-box">
              <span>网易云 Cookie</span>
              <textarea
                value={cookieText}
                onChange={(event) => onCookieTextChange(event.target.value)}
                placeholder="粘贴从网易云网页复制的登录信息"
              />
            </label>
            <button type="button" onClick={onSaveCookie} disabled={cookieSaving || !cookieText.trim()} title="保存 Cookie">
              <Save size={17} />
              {cookieSaving ? "保存中" : "保存 Cookie"}
            </button>
            {login?.source === "cookie" ? (
              <button type="button" className="ghost-button" onClick={onCancelCookieReplace} disabled={cookieSaving} title="取消更换 Cookie">
                取消
              </button>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="panel-header compact">
        <p className="eyebrow">真实数据</p>
        <h2>网易云曲库</h2>
      </div>
      <div className="library-summary">
        <div className="library-count">
          <span>已同步歌曲</span>
          <strong>{syncCounts?.songs ?? "待同步"}</strong>
        </div>
        <div className="library-status-list">
          <div>
            <span>同步状态</span>
            <strong>{syncLoading ? "同步中" : syncCounts ? "已同步" : "未同步"}</strong>
          </div>
          <div>
            <span>可播放</span>
            <strong>{syncCounts?.playableSongs ?? "生成后"}</strong>
          </div>
          <div>
            <span>来源</span>
            <strong>{loginChecking ? "连接中" : login?.source === "cookie" ? "网易云" : "等待登录"}</strong>
          </div>
          {hasSyncFailures ? (
            <div>
              <span>拉取异常</span>
              <strong>{syncCounts?.partialFailures ?? syncFailures.length}</strong>
            </div>
          ) : null}
        </div>
      </div>
      <div className="tool-row">
        <button type="button" title={syncButtonLabel} aria-label={syncButtonLabel} onClick={onSync} disabled={syncLoading || tagLoading || !canSync}>
          <RefreshCcw size={18} />
          {syncButtonLabel}
        </button>
        <button type="button" title={expandButtonLabel} aria-label={expandButtonLabel} onClick={onExpand} disabled={expandLoading || syncLoading || tagLoading || !canSync}>
          <RefreshCcw size={18} />
          {expandButtonLabel}
        </button>
        <button type="button" title={tagButtonLabel} aria-label={tagButtonLabel} onClick={onTag} disabled={tagLoading || syncLoading || expandLoading || !canSync}>
          <RefreshCcw size={18} />
          {tagButtonLabel}
        </button>
      </div>
      <p className="data-note">
        {syncCounts
          ? `本地曲库 ${syncCounts.songs} 首，推荐只从这些真实歌曲里生成。${syncCounts.lastSyncAt ? `上次更新：${formatTime(syncCounts.lastSyncAt)}。` : ""}`
          : "先同步网易云数据；未同步时不会返回假歌单。"}
      </p>
      {syncFailures.length ? (
        <ul className="failure-list">
          {syncFailures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusText(login: LoginState | null) {
  if (login?.source === "cookie") return "已使用本地保存的网易云登录状态，不需要再扫码。";
  if (login?.status === "authorized") return "已授权，后续可以同步你的红心歌和歌单。";
  if (login?.status === "scanned") return "已扫码，请在手机上确认登录。";
  if (login?.status === "expired") return "二维码已过期，建议直接导入网页登录信息。";
  return "如果扫码被网易云拦截，请从浏览器复制网易云登录信息后粘贴保存。";
}
