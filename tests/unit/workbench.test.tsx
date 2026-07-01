import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RecommendationFlowPage } from "@/components/workbench/RecommendationFlowPage";
import { RecommendationPanel, type RecommendationResponse } from "@/components/workbench/RecommendationPanel";
import { StrategyPanel } from "@/components/workbench/StrategyPanel";
import { Workbench } from "@/components/workbench/Workbench";

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn(() => Promise.resolve())
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn()
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    value: vi.fn()
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("Workbench", () => {
  it("renders a clean player page without exposing admin data controls", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Promise<Response>(() => undefined));

    const { container } = render(<Workbench />);

    expect(screen.queryByRole("textbox", { name: /听歌场景/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "输入场景" })).toBeInTheDocument();
    expect(screen.getByText("先连上你的网易云音乐")).toBeInTheDocument();
    expect(container.querySelector(".player-app")).toBeInTheDocument();
    expect(container.querySelector(".control-rail")).not.toBeInTheDocument();
    expect(container.querySelector(".control-rail")).not.toBeInTheDocument();
    expect(screen.queryByText(/Cookie/i)).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("loads existing local library status without exposing library counts on the player page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 6958, playableSongs: 6721, partialFailures: 0 } }));
      }
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    const { container } = render(<Workbench />);

    expect(await screen.findByText("准备好播放了")).toBeInTheDocument();
    expect(screen.queryByText("6958 棣栫湡瀹炲€欓€夋瓕")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync?mode=quick")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("loads a default liked queue on first entry when local library exists", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 24, playableSongs: 20, partialFailures: 0 } }));
      }
      if (url === "/api/default-queue?limit=12") {
        return new Response(JSON.stringify(defaultLikedResult));
      }
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench />);

    expect((await screen.findAllByText("默认喜欢歌曲 A")).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/default-queue?limit=12");
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/recommendations")).toBe(false);

    fetchMock.mockRestore();
  });

  it("silently syncs once for a first-use consumer after login is authorized and the local library is empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
      }
      if (url === "/api/sync?mode=quick") {
        return new Response(JSON.stringify({ counts: { songs: 18, playableSongs: 16, imported: 18, partialFailures: 0 }, partialFailures: [] }));
      }
      if (url === "/api/default-queue?limit=12") {
        return new Response(JSON.stringify(defaultLikedResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench silentSyncOnFirstUse />);

    expect((await screen.findAllByText("默认喜欢歌曲 A")).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync?mode=quick")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/sync?mode=quick", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledWith("/api/default-queue?limit=12");
    expect(screen.queryByText(/18/)).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("does not run silent first-use sync in admin mode when the library is empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench mode="admin" silentSyncOnFirstUse />);

    expect(await screen.findByText("网易云已连接")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync?mode=quick")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("shows a consumer QR login entry on first use when there is no saved backend Cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "qr-key", qrUrl: "data:image/png;base64,qr", source: "qr" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
      }
      return new Response(JSON.stringify({ status: "waiting" }));
    });

    render(<Workbench silentSyncOnFirstUse />);

    expect(await screen.findByRole("img", { name: "网易云扫码登录二维码" })).toHaveAttribute("src", "data:image/png;base64,qr");
    expect(screen.getByRole("img", { name: "网易云扫码登录二维码" })).toBeInTheDocument();
    expect(screen.queryByText(/Cookie/i)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync?mode=quick")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("shows a fresh consumer QR login and skips silent sync when the saved login state is expired", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/state") {
        return new Response(JSON.stringify({ login: { provider: "netease", status: "expired", source: "cookie", lastVerifiedAt: "2026-06-30T00:00:00.000Z" } }));
      }
      if (url === "/api/login/qr?force=1") {
        return new Response(JSON.stringify({ key: "expired-relogin", qrUrl: "data:image/png;base64,relogin", source: "qr" }));
      }
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
      }
      return new Response(JSON.stringify({ status: "waiting" }));
    });

    render(<Workbench silentSyncOnFirstUse />);

    expect(await screen.findByRole("img", { name: "网易云扫码登录二维码" })).toHaveAttribute("src", "data:image/png;base64,relogin");
    expect(fetchMock).toHaveBeenCalledWith("/api/login/state");
    expect(fetchMock).toHaveBeenCalledWith("/api/login/qr?force=1");
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync?mode=quick")).toHaveLength(0);
    expect(screen.queryByText(/Cookie/i)).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("uses forced QR status polling after an expired login and then resumes first-use playback", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/state") {
        return new Response(JSON.stringify({ login: { provider: "netease", status: "expired", source: "cookie", lastVerifiedAt: "2026-06-30T00:00:00.000Z" } }));
      }
      if (url === "/api/login/qr?force=1") {
        return new Response(JSON.stringify({ key: "expired-relogin", qrUrl: "data:image/png;base64,relogin", source: "qr" }));
      }
      if (url === "/api/login/status?key=expired-relogin&force=1") {
        return new Response(JSON.stringify({ status: "authorized", source: "qr" }));
      }
      if (url === "/api/login/status?key=expired-relogin") {
        return new Response(JSON.stringify({ status: "authorized", source: "cookie" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, lastSyncAt: null, partialFailures: 0 } }));
      }
      if (url === "/api/sync?mode=quick") {
        return new Response(JSON.stringify({ counts: { songs: 12, playableSongs: 10, imported: 12, partialFailures: 0 }, partialFailures: [] }));
      }
      if (url === "/api/default-queue?limit=12") {
        return new Response(JSON.stringify(defaultLikedResult));
      }
      return new Response(JSON.stringify({ status: "waiting" }));
    });

    try {
      render(<Workbench silentSyncOnFirstUse />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(document.querySelector("img[src=\"data:image/png;base64,relogin\"]")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith("/api/login/qr?force=1");
      expect(fetchMock).toHaveBeenCalledWith("/api/login/status?key=expired-relogin&force=1");
      expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/login/status?key=expired-relogin")).toBe(false);
      expect(fetchMock).toHaveBeenCalledWith("/api/sync?mode=quick", { method: "POST" });
      expect(document.querySelector('audio[src="/api/playback?id=default-liked-1"]')).toBeInTheDocument();
      expect(screen.queryByText(/Cookie/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      fetchMock.mockRestore();
    }
  });

  it("keeps the QR login surface inside admin controls on the admin page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "qr-key", qrUrl: "data:image/png;base64,qr", source: "qr" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
      }
      return new Response(JSON.stringify({ status: "waiting" }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByRole("img", { name: "网易云扫码登录二维码" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "网易云扫码登录二维码" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync?mode=quick")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("moves from QR authorization into silent first-use preparation without showing sync internals", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "qr-key", qrUrl: "data:image/png;base64,qr", source: "qr" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
      }
      if (url === "/api/login/status?key=qr-key") {
        return new Response(JSON.stringify({ status: "authorized", source: "qr" }));
      }
      if (url === "/api/sync?mode=quick") {
        return new Promise<Response>(() => undefined);
      }
      return new Response(JSON.stringify({ status: "waiting" }));
    });

    render(<Workbench silentSyncOnFirstUse />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector("img[src=\"data:image/png;base64,qr\"]")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(screen.queryByText("正在同步")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/sync?mode=quick", { method: "POST" });

    vi.useRealTimers();
    fetchMock.mockRestore();
  });

  it("loads the default queue after QR authorization finishes first-use sync", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/state") {
        return new Response(JSON.stringify({ login: { provider: "netease", status: "missing", source: null, lastVerifiedAt: null } }));
      }
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "qr-key", qrUrl: "data:image/png;base64,qr", source: "qr" }));
      }
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, lastSyncAt: null, partialFailures: 0 } }));
      }
      if (url === "/api/login/status?key=qr-key") {
        return new Response(JSON.stringify({ status: "authorized", source: "qr" }));
      }
      if (url === "/api/sync?mode=quick") {
        return new Response(JSON.stringify({ counts: { songs: 12, playableSongs: 10, imported: 12, partialFailures: 0 }, partialFailures: [] }));
      }
      if (url === "/api/default-queue?limit=12") {
        return new Response(JSON.stringify(defaultLikedResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    try {
      render(<Workbench silentSyncOnFirstUse />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(document.querySelector("img[src=\"data:image/png;base64,qr\"]")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(document.querySelector('audio[src="/api/playback?id=default-liked-1"]')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/sync?mode=quick", { method: "POST" });
      expect(fetchMock).toHaveBeenCalledWith("/api/default-queue?limit=12");
      expect(screen.queryByText(/Cookie/i)).not.toBeInTheDocument();
      expect(screen.queryByText("姝ｅ湪鍚屾")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      fetchMock.mockRestore();
    }
  });

  it("lets the player request recommendations from local storage without waiting for login status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      if (url === "/api/recommendations") {
        return new Response(JSON.stringify(firstPageResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    const { container } = render(<Workbench />);

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    expect(screen.getByRole("dialog", { name: "场景推荐" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /听歌场景/i }), { target: { value: "写代码，安静，少人声" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));
    expect(screen.queryByRole("dialog", { name: "场景推荐" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recommendations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            prompt: "写代码，安静，少人声",
            text: "写代码，安静，少人声",
            mode: "balanced",
            scene: "general",
            limit: 12,
            excludeIds: []
          })
        })
      );
    });

    fetchMock.mockRestore();
  });

  it("sends recommendation mode, scene, and free text when generating a queue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      if (url === "/api/recommendations") {
        return new Response(JSON.stringify(firstPageResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench />);

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.click(screen.getByRole("button", { name: "探索新歌" }));
    fireEvent.click(screen.getByRole("button", { name: "下一首开始" }));
    fireEvent.click(screen.getByRole("button", { name: "写代码" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "quiet focus" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recommendations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            prompt: "quiet focus",
            text: "quiet focus",
            mode: "explore",
            scene: "work_focus",
            limit: 12,
            excludeIds: []
          })
        })
      );
    });

    fetchMock.mockRestore();
  });

  it("confirms mode switching before replacing the current queue", async () => {
    const onModeChange = vi.fn();
    const onRecommend = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="coding"
        recommendationMode="balanced"
        recommendationScene="work_focus"
        onPromptChange={() => undefined}
        onModeChange={onModeChange}
        onRecommend={onRecommend}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.click(screen.getByRole("button", { name: "探索新歌" }));

    expect(screen.getByRole("dialog", { name: "切换推荐模式" })).toBeInTheDocument();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "下一首开始" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即播放新队列" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一首开始" }));

    expect(onModeChange).toHaveBeenCalledWith("explore");
    expect(onRecommend).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "切换推荐模式" })).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("passes the pending mode into immediate mode replacement", async () => {
    const onModeChange = vi.fn();
    const onRecommend = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="coding"
        recommendationMode="balanced"
        recommendationScene="work_focus"
        onPromptChange={() => undefined}
        onModeChange={onModeChange}
        onRecommend={onRecommend}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.click(screen.getByRole("button", { name: "探索新歌" }));
    fireEvent.click(screen.getByRole("button", { name: "立即播放新队列" }));

    expect(onModeChange).toHaveBeenCalledWith("explore");
    expect(onRecommend).toHaveBeenCalledWith({ mode: "explore" });

    fetchMock.mockRestore();
  });

  it("clears the prompt and tries to play after successful recommendation generation", async () => {
    const playMock = vi.mocked(HTMLMediaElement.prototype.play);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      if (url === "/api/recommendations") {
        return new Response(JSON.stringify(firstPageResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench />);

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "quiet focus" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    await waitFor(() => expect(playMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    expect(screen.getByRole("textbox")).toHaveValue("");

    fetchMock.mockRestore();
  });

  it("keeps the prompt when recommendation generation fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      if (url === "/api/recommendations") {
        return new Response(JSON.stringify({ error: "DeepSeek 调用失败" }), { status: 400 });
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench />);

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "quiet focus" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    expect(await screen.findByText("DeepSeek 调用失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    expect(screen.getByRole("textbox")).toHaveValue("quiet focus");

    fetchMock.mockRestore();
  });

  it("stores the latest recommendation flow with raw AI returns for the standalone flow page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      if (url === "/api/recommendations") {
        return new Response(JSON.stringify(recommendationResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench />);

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.change(screen.getByRole("textbox", { name: /听歌场景/i }), { target: { value: "写代码，安静，少人声" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem("latestRecommendationResult")).toContain("AI 原始意图返回");
      expect(window.localStorage.getItem("latestRecommendationResult")).toContain("AI 原始意图返回");
    });

    fetchMock.mockRestore();
  });

  it("does not let a late default liked queue overwrite the latest AI recommendation flow", async () => {
    let releaseDefaultQueue!: (response: Response) => void;
    const defaultQueueResponse = new Promise<Response>((resolve) => {
      releaseDefaultQueue = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/library") {
        return new Response(JSON.stringify({ counts: { songs: 24, playableSongs: 20, partialFailures: 0 } }));
      }
      if (url === "/api/default-queue?limit=12") {
        return defaultQueueResponse;
      }
      if (url === "/api/login/qr") {
        return new Promise<Response>(() => undefined);
      }
      if (url === "/api/recommendations") {
        return new Response(JSON.stringify(recommendationResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench />);

    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    fireEvent.change(screen.getByRole("textbox", { name: /听歌场景/i }), { target: { value: "写代码，安静，少人声" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem("latestRecommendationResult")).toContain("AI 原始意图返回");
    });

    await act(async () => {
      releaseDefaultQueue(new Response(JSON.stringify(defaultLikedResult)));
      await defaultQueueResponse;
    });

    expect(window.sessionStorage.getItem("latestRecommendationResult")).toContain("AI 原始意图返回");
    expect(window.sessionStorage.getItem("latestRecommendationResult")).not.toContain("default-liked");

    fetchMock.mockRestore();
  });

  it("renders the standalone recommendation flow page from the latest saved result", async () => {
    window.sessionStorage.setItem("latestRecommendationResult", JSON.stringify(recommendationResult));

    render(<RecommendationFlowPage />);

    expect(await screen.findByRole("heading", { name: "推荐生成流程" })).toBeInTheDocument();
    expect(screen.getByText("数据流节点图")).toBeInTheDocument();
    expect(screen.getAllByText(/15/).length).toBeGreaterThan(0);
    expect(screen.getByText("用户输入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /02 推荐接口请求/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /05 本地曲库读取/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /06 播放冷却过滤/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /08 来源召回/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /10 标签增强/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /13 本地补齐/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /14/ })).toBeInTheDocument();
    expect(screen.getByText("节点输入")).toBeInTheDocument();
    expect(screen.getByText("处理动作")).toBeInTheDocument();
    expect(screen.getByText("节点输出")).toBeInTheDocument();
    expect(screen.getAllByText(/AI/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/7/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /03/ }));
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("缺少画像，已跳过");
    expect(screen.getByRole("region", { name: "当前节点详情" })).not.toHaveTextContent("已生成 AI 偏好摘要");

    fireEvent.click(screen.getByRole("button", { name: /11/ }));
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent(/1/);
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("Excluded High Energy Song");

    fireEvent.click(screen.getByRole("button", { name: /12 AI 重排/ }));
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("AI 原始推荐理由");
    expect(screen.getByText("AI 完整返回")).toBeInTheDocument();
    expect(screen.getAllByText("请求输入").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Return JSON only/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/coding/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 原始意图返回/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 原始推荐理由/).length).toBeGreaterThan(0);
  });

  it("exposes mode, scene, Top 200, Top 50, AI pool, and local fill details on the flow page", async () => {
    window.sessionStorage.setItem("latestRecommendationResult", JSON.stringify(flowAuditResult));

    render(<RecommendationFlowPage />);

    expect(await screen.findByRole("heading", { name: "推荐生成流程" })).toBeInTheDocument();
    expect(screen.getAllByText("平衡推荐").length).toBeGreaterThan(0);
    expect(screen.getAllByText("work_focus").length).toBeGreaterThan(0);
    expect(screen.getAllByText("别太困，有点律动").length).toBeGreaterThan(0);
    expect(screen.getAllByText("本地 Top 200").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI Top 50").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("红心 45%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("相似 35%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("扩展 20%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("liked: 18").length).toBeGreaterThan(0);
    expect(screen.getAllByText("exploration: 8").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 完整返回/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI 原始推荐理由/).length).toBeGreaterThan(0);
  });

  it("renders admin data controls on the admin page mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "login-unavailable", qrUrl: "" }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    const { container } = render(<Workbench mode="admin" />);

    expect(await screen.findByText("网易云登录")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /网易云 Cookie/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /听歌场景/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "输入场景" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Cookie" })).toBeDisabled();
    expect(container.querySelector(".control-rail .music-sidebar")).toBeInTheDocument();
    expect(container.querySelector(".control-rail .strategy-panel")).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("shows tag queue operations only in admin mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/tags/queue?limit=8") {
        return new Response(
          JSON.stringify({
            counts: { pending: 3, processing: 1, done: 8, failed: 2 },
            jobs: [
              { id: 12, songId: 42, reason: "sync", status: "pending", attempts: 0 },
              { id: 11, songId: 41, reason: "expand", status: "failed", attempts: 2 }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ counts: { songs: 0, partialFailures: 0 } }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByText("AI 打标队列")).toBeInTheDocument();
    expect(await screen.findByText("pending 3")).toBeInTheDocument();
    expect(screen.getByText("done 8")).toBeInTheDocument();
    expect(screen.getByText("failed 2")).toBeInTheDocument();
    expect(screen.getByText("attempts 2")).toBeInTheDocument();

    cleanup();
    fetchMock.mockImplementation(async () => new Promise<Response>(() => undefined));
    render(<Workbench mode="player" />);

    expect(screen.queryByText("AI 打标队列")).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("shows profile diagnostics only in admin mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/profiles/status") {
        return new Response(
          JSON.stringify({
            profile: {
              exists: true,
              confidence: 0.42,
              stale: false,
              lastRefreshedAt: "2026-06-30 01:00:00",
              summaryLength: 64
            }
          })
        );
      }
      if (url === "/api/tags/queue?limit=8") {
        return new Response(JSON.stringify({ counts: { pending: 0, processing: 0, done: 0, failed: 0 }, jobs: [] }));
      }
      return new Response(JSON.stringify({ counts: { songs: 0, partialFailures: 0 } }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByText("User Profile")).toBeInTheDocument();
    expect(await screen.findByText("confidence 0.42")).toBeInTheDocument();
    expect(screen.getByText("fresh")).toBeInTheDocument();
    expect(screen.getByText("summary length 64")).toBeInTheDocument();

    cleanup();
    fetchMock.mockImplementation(async () => new Promise<Response>(() => undefined));
    render(<Workbench mode="player" />);

    expect(screen.queryByText("User Profile")).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("processes the tag queue from admin mode and refreshes queue status", async () => {
    let queueReads = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/tags/queue?limit=8") {
        queueReads += 1;
        return new Response(
          JSON.stringify(
            queueReads === 1
              ? {
                  counts: { pending: 2, processing: 0, done: 0, failed: 0 },
                  jobs: [{ id: 21, songId: 101, reason: "sync", status: "pending", attempts: 0 }]
                }
              : {
                  counts: { pending: 0, processing: 0, done: 2, failed: 0 },
                  jobs: [{ id: 21, songId: 101, reason: "sync", status: "done", attempts: 1 }]
                }
          )
        );
      }
      if (url === "/api/tags/queue/process") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ limit: 8 });
        return new Response(JSON.stringify({ counts: { processed: 2, succeeded: 2, failed: 0 }, songs: [] }));
      }
      return new Response(JSON.stringify({ counts: { songs: 0, partialFailures: 0 } }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByText("pending 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "处理队列" }));

    expect(await screen.findByText("done 2")).toBeInTheDocument();
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tags/queue/process",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 8 })
      })
    );

    fetchMock.mockRestore();
  });

  it("syncs the real NetEase library from admin mode only when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/sync") {
        return new Response(
          JSON.stringify({
            counts: { songs: 746, partialFailures: 0 },
            partialFailures: []
          })
        );
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByText("网易云已连接")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "同步网易云数据" }));
    expect(await screen.findByText("746")).toBeInTheDocument();
    expect(screen.getByText("曲库就绪")).toBeInTheDocument();
    expect(screen.getByText("候选来源：生成后显示真实来源")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/sync", { method: "POST" });

    fetchMock.mockRestore();
  });

  it("requests recommendations with limit and excludeIds when continuing the queue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/sync") {
        return new Response(JSON.stringify({ counts: { songs: 40, partialFailures: 0 }, partialFailures: [] }));
      }
      if (url === "/api/recommendations") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { excludeIds?: string[] };
        return new Response(JSON.stringify(body.excludeIds?.length ? secondPageResult : firstPageResult));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    const { container } = render(<Workbench />);
    fireEvent.click(await screen.findByRole("button", { name: "输入场景" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /听歌场景/i }), { target: { value: "写代码，安静，少人声" } });
    fireEvent.click(await screen.findByRole("button", { name: /生成推荐/i }));

    await waitFor(() => {
      expect(container.querySelector(".player-shell")).toHaveTextContent("First Page Song 1");
    });
    fireEvent.click(screen.getByRole("button", { name: "打开播放队列" }));
    expect(await screen.findByRole("dialog", { name: "播放队列" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /First Page Song 10/ }));

    await waitFor(() => {
      const recommendationCalls = fetchMock.mock.calls.filter(([input]) => String(input) === "/api/recommendations");
      expect(recommendationCalls).toHaveLength(2);
      expect(JSON.parse(String(recommendationCalls[1][1]?.body))).toEqual(
        expect.objectContaining({
          limit: 12,
          excludeIds: firstPageResult.items.map((item) => item.id)
        })
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "打开播放队列" }));
    await waitFor(() => {
      expect(screen.getAllByText("Second Page Song 1").length).toBeGreaterThan(0);
    });

    fetchMock.mockRestore();
  });

  it("saves item feedback from the player", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      return new Response(JSON.stringify({ ok: true }));
    });
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "标记喜欢 真实歌曲 A" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/feedback",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ itemId: "101", feedback: "like" })
        })
      );
    });
    expect(screen.getByRole("button", { name: "标记喜欢 真实歌曲 A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "标记喜欢 真实歌曲 A" })).toHaveAttribute("aria-pressed", "true");

    fetchMock.mockRestore();
  });

  it("keeps autoplay failure quiet but shows a notice after a manual play failure", async () => {
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error("NotAllowedError"));

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
        autoPlayToken={1}
      />
    );

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(screen.queryByText("播放启动失败，请再点一次或换一首。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "播放" }));

    await waitFor(() => {
      expect(screen.getByText("播放启动失败，请再点一次或换一首。")).toBeInTheDocument();
    });

    fetchMock.mockRestore();
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.load = originalLoad;
  });

  it("shows category tags and keeps the queue behind a button", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 A");
    expect(screen.getAllByText("安静").length).toBeGreaterThan(0);
    expect(screen.getAllByText("安静").length).toBeGreaterThan(0);
    expect(container.querySelector(".lyric-panel")).not.toBeInTheDocument();
    expect(container.querySelector(".player-insight")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "推荐逻辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "输入场景" })).toHaveTextContent("我想听...");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/lyrics"))).toBe(false);
    expect(screen.queryByText(/2 songs/)).not.toBeInTheDocument();
    expect(screen.queryByText("2 首可播放")).not.toBeInTheDocument();
    expect(screen.queryByText(/continuing/i)).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 2")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".song-card")).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "播放队列" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开播放队列" }));
    expect(screen.getByRole("dialog", { name: "播放队列" })).toBeInTheDocument();
    expect(screen.queryByText("本轮推荐")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".queue-index")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /真实歌曲 B/ }));
      await Promise.resolve();
    });
    expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 B");
    expect(screen.getAllByText("摇滚").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/lyrics"))).toBe(false);

    fetchMock.mockRestore();
  });

  it("uses previous and next controls to switch the active song", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 A");
    fireEvent.click(screen.getByRole("button", { name: "下一首" }));
    expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 B");
    fireEvent.click(screen.getByRole("button", { name: "上一首" }));
    await waitFor(() => expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 A"));

    fetchMock.mockRestore();
  });

  it("shows recommendation source labels in the player and queue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={sourceLabelResult}
        libraryCounts={{ songs: 3, partialFailures: 0 }}
      />
    );

    expect(screen.getAllByText("AI 选中").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "打开播放队列" }));
    expect(screen.getByText("本地补齐")).toBeInTheDocument();
    expect(screen.getAllByText("真实歌曲 B").length).toBeGreaterThan(0);

    fetchMock.mockRestore();
  });

  it("shows a seekable playback timeline in the immersive player", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    const slider = screen.getByRole("slider", { name: "播放进度" }) as HTMLInputElement;
    const audio = container.querySelector("audio") as HTMLAudioElement;

    Object.defineProperty(audio, "duration", { configurable: true, value: 185 });
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 42 });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/play-events",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            itemId: "101",
            playedSeconds: 42,
            durationSeconds: 185,
            completed: false
          })
        })
      );
    });
    expect(slider).toHaveValue("42");
    expect(screen.getByText("00:42")).toBeInTheDocument();
    expect(screen.getByText("03:05")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "64" } });

    expect(audio.currentTime).toBe(64);

    fetchMock.mockRestore();
  });

  it("keeps playback going when the user clicks next", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const playMock = vi.mocked(HTMLMediaElement.prototype.play);
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "下一首" }));
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(2));

    fetchMock.mockRestore();
  });

  it("shows a proactive companion bubble once after the playback threshold", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/companion/proactive") {
        return new Response(JSON.stringify({ message: "This chorus lands right where the pulse softens." }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );
    const audio = container.querySelector("audio") as HTMLAudioElement;

    Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 29 });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/companion/proactive")).toHaveLength(0);
    expect(screen.queryByText("This chorus lands right where the pulse softens.")).not.toBeInTheDocument();

    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);

    expect(await screen.findByText("This chorus lands right where the pulse softens.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/companion/proactive")).toHaveLength(1);

    audio.currentTime = 72;
    fireEvent.timeUpdate(audio);
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/companion/proactive")).toHaveLength(1);

    fireEvent.click(screen.getByText("This chorus lands right where the pulse softens."));

    expect(screen.getByRole("dialog", { name: "一起听" })).toBeInTheDocument();
    expect(screen.getAllByText("This chorus lands right where the pulse softens.").length).toBeGreaterThanOrEqual(1);

    fetchMock.mockRestore();
  });

  it("loads synced lyrics when the user taps the cover and highlights the current line", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("/api/lyrics")) {
        return new Response(
          JSON.stringify({
            lines: [
              { time: 0, text: "previous lyric" },
              { time: 40, text: "current lyric", translation: "current line" },
              { time: 80, text: "next lyric" }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );
    const audio = container.querySelector("audio") as HTMLAudioElement;

    Object.defineProperty(audio, "duration", { configurable: true, value: 185 });
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 42 });
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);
    fireEvent.click(screen.getByRole("button", { name: "切换到歌词" }));

    expect(await screen.findByText("current lyric")).toBeInTheDocument();
    expect(container.querySelector(".lyric-line.is-active")).toHaveTextContent("current lyric");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/lyrics?id=101"))).toBe(true);

    fetchMock.mockRestore();
  });

  it("highlights the first lyric line before the first timestamp starts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("/api/lyrics")) {
        return new Response(
          JSON.stringify({
            lines: [
              { time: 20, text: "first lyric" },
              { time: 40, text: "second lyric" }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "切换到歌词" }));

    expect(await screen.findByText("first lyric")).toBeInTheDocument();
    expect(container.querySelector(".lyric-line.is-active")).toHaveTextContent("first lyric");

    fetchMock.mockRestore();
  });

  it("opens the companion chat from the player controls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开一起听" }));

    expect(screen.getByRole("dialog", { name: "一起听" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("想聊聊这首吗？")).toBeInTheDocument();
    expect(screen.getAllByText("真实歌曲 A").length).toBeGreaterThan(0);

    fetchMock.mockRestore();
  });

  it("sends companion chat messages to the backend with current song context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/chat") {
        return new Response(JSON.stringify({ message: "I hear that line as a small late-night pause." }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开一起听" }));
    fireEvent.change(screen.getByPlaceholderText("想聊聊这首吗？"), { target: { value: "this line hits" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("I hear that line as a small late-night pause.");

    const chatCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/chat");
    expect(chatCall).toBeTruthy();
    expect(JSON.parse(String(chatCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        message: "this line hits",
        song: expect.objectContaining({
          id: "101",
          name: "真实歌曲 A",
          artists: ["歌手 A"]
        }),
        history: expect.arrayContaining([expect.objectContaining({ role: "companion" })])
      })
    );
    expect(screen.queryByText(/后面会接入真正的对话接口/)).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("keeps mini player controls available inside companion chat", async () => {
    const playMock = vi.mocked(HTMLMediaElement.prototype.play);
    const pauseMock = vi.mocked(HTMLMediaElement.prototype.pause);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开一起听" }));
    fireEvent.click(screen.getByRole("button", { name: "聊天播放" }));
    await waitFor(() => expect(playMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "聊天下一首" }));
    await waitFor(() => expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 B"));

    fireEvent.click(screen.getByRole("button", { name: "聊天暂停" }));
    expect(pauseMock).toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("opens a visual recommendation flow with AI filtering and ranking details", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "推荐逻辑" }));

    expect(screen.getByRole("dialog", { name: "推荐逻辑" })).toBeInTheDocument();
    expect(screen.getByText("用户输入")).toBeInTheDocument();
    expect(screen.getAllByText("AI 意图解析").length).toBeGreaterThan(0);
    expect(screen.getAllByText("最终推荐").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 重排").length).toBeGreaterThan(0);
    expect(screen.getByText("Excluded High Energy Song")).toBeInTheDocument();
    expect(screen.getAllByText("energy:high").length).toBeGreaterThan(0);
    expect(screen.getByText("AI 完整返回")).toBeInTheDocument();
    expect(screen.getAllByText(/AI 原始意图返回/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "打开完整流程页" })).toHaveAttribute("href", "/flow");

    fetchMock.mockRestore();
  });

  it("plays through the local playback proxy and skips after a failed stream", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="coding"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );
    const audio = container.querySelector("audio");

    expect(audio).toHaveAttribute("src", "/api/playback?id=101");

    fireEvent.error(audio as HTMLAudioElement);

    expect(await screen.findByText("播放地址失效，正在换一首。")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 B");
    });
    expect(container.querySelector("audio")).toHaveAttribute("src", "/api/playback?id=102");

    fetchMock.mockRestore();
  });

  it("shows real admin strategy information without recommendation counts", () => {
    render(<StrategyPanel result={recommendationResult} libraryCounts={{ songs: 2, partialFailures: 0 }} />);

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("本轮推荐")).not.toBeInTheDocument();
    expect(screen.queryByText("coding")).not.toBeInTheDocument();
    expect(screen.queryByText("2 ?")).not.toBeInTheDocument();
    expect(screen.getByText("当前场景").parentElement).toHaveTextContent("工作 / 写代码");
  });

  it("lets a backend-cookie login replace the saved Cookie in admin mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/sync") {
        return new Response(JSON.stringify({ counts: { songs: 280, partialFailures: 0 }, partialFailures: [] }));
      }
      if (url === "/api/login/cookie") {
        return new Response(JSON.stringify({ ok: true, status: "authorized", source: "cookie" }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByText("网易云已连接")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /网易云 Cookie/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更换账号" }));
    fireEvent.change(screen.getByRole("textbox", { name: /网易云 Cookie/i }), { target: { value: "unit_test_music_u_token_for_cookie_normalization_000000000000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Cookie" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/login/cookie",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ cookie: "unit_test_music_u_token_for_cookie_normalization_000000000000" })
        })
      );
    });
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync")).toHaveLength(0);

    fetchMock.mockRestore();
  });

  it("runs AI tag enrichment as a manual admin action", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/login/qr") {
        return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
      }
      if (url === "/api/tags") {
        return new Response(JSON.stringify({ counts: { songs: 280, imported: 8, playableSongs: 260, partialFailures: 0 }, partialFailures: [] }));
      }
      return new Response(JSON.stringify({ ok: true }));
    });

    render(<Workbench mode="admin" />);

    expect(await screen.findByText("网易云已连接")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "补充 AI 标签" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tags",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ limit: 100 })
        })
      );
    });

    fetchMock.mockRestore();
  });
});

const recommendationResult: RecommendationResponse = {
  context: { scene: "work", mood: ["calm", "focused"], novelty: "balanced" },
  strategy: { candidateSources: ["liked", "playlist"], partialFailures: [], novelty: "balanced" },
  libraryCounts: { songs: 2, partialFailures: 0 },
  page: { requested: 12, returned: 2, excluded: 0, hasMore: true },
  flow: {
    input: { prompt: "coding", requested: 2, excludedPlayedIds: [] },
    context: {
      scene: "work",
      mood: ["calm", "focused"],
      novelty: "balanced",
      energy: "low",
      vocal: "less_vocal",
      avoid: ["太吵"],
      targetTags: ["scene:focus", "mood:calm"],
      excludeTags: ["energy:high"],
      familiarRatio: 0.6,
      exploreRatio: 0.4
    },
    library: { totalSongs: 3, afterPlayedExclusion: 3, sourceNames: ["liked", "playlist"] },
    tags: {
      totalSongs: 3,
      aiTaggedSongs: 1,
      aiTagCoverage: 1 / 3,
      examples: ["ai:tagged", "ai:scene:focus"]
    },
    filters: {
      excludeTags: ["energy:high"],
      excludedByTags: [{ id: "999", name: "Excluded High Energy Song", artistNames: ["Artist C"], matchedTags: ["energy:high"] }],
      cooldownExcluded: [{ id: "888", name: "Recently Played Song", artistNames: ["Artist D"], reason: "7 day cooldown", cooldownDays: 7 }]
    },
    ranking: {
      localRankedCount: 3,
      afterTagFilterCount: 2,
      aiRerankedCount: 2,
      finalCount: 2,
      topLocal: [],
      final: [
        { id: "101", name: "Real Song A", artistNames: ["Artist A"], score: 8.4, tags: ["calm"], reason: "AI reason A", rank: 1 },
        { id: "102", name: "Real Song B", artistNames: ["Artist B"], score: 7.8, tags: ["rock"], reason: "AI reason B", rank: 2 }
      ]
    },
    ai: {
      calls: [
        {
          id: "preference-skipped-1",
          stage: "preference",
          title: "AI preference summary skipped",
          request: { profileData: {} },
          rawResponse: "",
          parsed: { skipped: true, reason: "缺少画像，已跳过" }
        },
        {
          id: "intent-1",
          stage: "intent",
          title: "AI 意图解析",
          model: "deepseek-chat",
          request: {
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "Return JSON only." },
              { role: "user", content: JSON.stringify({ input: "coding", profileSummary: "preference summary" }) }
            ],
            response_format: { type: "json_object" }
          },
          rawResponse: "{\"message\":\"AI 原始意图返回\",\"targetTags\":[\"scene:focus\"]}",
          parsed: { message: "AI 原始意图返回", targetTags: ["scene:focus"] }
        },
        {
          id: "rerank-1",
          stage: "rerank",
          title: "AI 推荐重排",
          model: "deepseek-chat",
          request: {
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "Return JSON only." },
              { role: "user", content: JSON.stringify({ context: { scene: "work" }, candidates: [{ id: "101", name: "真实歌曲 A" }] }) }
            ],
            response_format: { type: "json_object" }
          },
          rawResponse: "{\"items\":[{\"id\":\"101\",\"reason\":\"AI 原始推荐理由\"}]}",
          parsed: { items: [{ id: "101", reason: "AI 原始推荐理由" }] }
        }
      ]
    }
  },
  items: [
    {
      id: "101",
      rank: 1,
      song: {
        neteaseSongId: "101",
        name: "真实歌曲 A",
        artistNames: ["歌手 A"],
        albumName: "专辑 A",
        coverUrl: "https://img.example/a.jpg",
        sources: ["liked"],
        tags: ["liked", "playable", "instrumental", "calm", "chinese"]
      },
      score: 8.4,
      reason: "AI reason A",
      streamUrl: "https://music.example/101.mp3",
      embedUrl: "https://music.163.com/outchain/player?type=2&id=101",
      playbackUrl: "https://music.163.com/#/song?id=101"
    },
    {
      id: "102",
      rank: 2,
      song: {
        neteaseSongId: "102",
        name: "真实歌曲 B",
        artistNames: ["歌手 B"],
        albumName: "专辑 B",
        coverUrl: null,
        sources: ["playlist"],
        tags: ["playlist", "rock", "live", "popular"]
      },
      score: 7.8,
      reason: "AI reason B",
      streamUrl: null,
      embedUrl: "https://music.163.com/outchain/player?type=2&id=102",
      playbackUrl: "https://music.163.com/#/song?id=102"
    }
  ]
};

const queuePlaybackResult: RecommendationResponse = {
  ...recommendationResult,
  items: recommendationResult.items.map((item) =>
    item.id === "102"
      ? {
          ...item,
          streamUrl: "https://music.example/102.mp3"
        }
      : item
  )
};

const flowAuditResult: RecommendationResponse = {
  ...recommendationResult,
  context: { ...recommendationResult.context, scene: "work_focus", mode: "balanced" },
  page: { requested: 12, returned: 2, excluded: 0, aiPoolSize: 50, hasMore: true },
  flow: {
    ...recommendationResult.flow!,
    input: {
      prompt: "别太困，有点律动",
      text: "别太困，有点律动",
      mode: "balanced",
      scene: "work_focus",
      requested: 12,
      excludedPlayedIds: []
    },
    context: {
      ...recommendationResult.flow!.context,
      scene: "work_focus",
      mode: "balanced",
      rhythm: "steady",
      distraction: "low"
    },
    recall: {
      modeMix: {
        mode: "balanced",
        familiarLibraryRatio: 0.45,
        librarySimilarRatio: 0.35,
        neteaseExtensionRatio: 0.2
      },
      candidateSourceCounts: {
        liked: 18,
        playlist: 14,
        exploration: 8
      }
    },
    ranking: {
      ...recommendationResult.flow!.ranking,
      localCandidateLimit: 200,
      aiTargetCount: 50,
      localRankedCount: 200,
      afterTagFilterCount: 180,
      aiRerankedCount: 50,
      aiSelectedCount: 1,
      localFillCount: 1,
      finalCount: 2,
      topLocal: [
        { id: "101", name: "Real Song A", artistNames: ["Artist A"], score: 91.2, tags: ["calm"], reason: "Top local candidate", rank: 1 },
        { id: "102", name: "Real Song B", artistNames: ["Artist B"], score: 86.7, tags: ["rock"], reason: "Local fill candidate", rank: 2 }
      ],
      final: [
        { id: "101", name: "真实歌曲 A", artistNames: ["歌手 A"], score: 8.4, tags: ["calm"], reason: "AI 原始推荐理由", rank: 1, selectionSource: "ai" },
        { id: "102", name: "真实歌曲 B", artistNames: ["歌手 B"], score: 7.8, tags: ["rock"], reason: "本地补齐理由", rank: 2, selectionSource: "local_fill" }
      ]
    }
  },
  items: [
    {
      ...recommendationResult.items[0],
      selectionSource: "ai",
      reason: "AI 原始推荐理由"
    },
    {
      ...recommendationResult.items[1],
      streamUrl: "https://music.example/102.mp3",
      selectionSource: "local_fill",
      reason: "本地补齐理由"
    }
  ]
};

const firstPageResult = pageResult("first", "First Page Song", true);
const secondPageResult = pageResult("second", "Second Page Song", false);

const sourceLabelResult: RecommendationResponse = {
  ...queuePlaybackResult,
  items: [
    {
      ...queuePlaybackResult.items[0],
      selectionSource: "ai"
    },
    {
      ...queuePlaybackResult.items[1],
      selectionSource: "local_fill"
    },
    {
      ...queuePlaybackResult.items[0],
      id: "103",
      song: {
        ...queuePlaybackResult.items[0].song,
        neteaseSongId: "103",
        name: "我喜欢随机歌"
      },
      selectionSource: "default_liked"
    }
  ]
};

const defaultLikedResult: RecommendationResponse = {
  ...recommendationResult,
  flow: {
    ...recommendationResult.flow!,
    input: { prompt: "default liked playback", requested: 2, excludedPlayedIds: [] },
    ai: { calls: [] }
  },
  items: [
    {
      ...recommendationResult.items[0],
      id: "default-liked-1",
      song: {
        ...recommendationResult.items[0].song,
        neteaseSongId: "default-liked-1",
        name: "默认喜欢歌曲 A",
        sources: ["liked"],
        tags: ["liked", "playback:playable", "mood:calm"]
      },
      reason: "Default liked recommendation",
      selectionSource: "default_liked"
    },
    {
      ...recommendationResult.items[1],
      id: "default-liked-2",
      streamUrl: "/api/playback?id=default-liked-2",
      song: {
        ...recommendationResult.items[1].song,
        neteaseSongId: "default-liked-2",
        name: "默认喜欢歌曲 B",
        sources: ["liked"],
        tags: ["liked", "playback:playable", "mood:focused"]
      },
      reason: "Default liked recommendation",
      selectionSource: "default_liked"
    }
  ]
};

function pageResult(prefix: string, namePrefix: string, hasMore: boolean): RecommendationResponse {
  return {
    context: { scene: "work", mood: ["calm"], novelty: "balanced" },
    strategy: { candidateSources: ["liked", "playlist"], partialFailures: [], novelty: "balanced" },
    libraryCounts: { songs: 40, partialFailures: 0 },
    page: { requested: 12, returned: 12, excluded: prefix === "first" ? 0 : 12, hasMore },
    items: Array.from({ length: 12 }, (_, index) => ({
      id: `${prefix}-${index + 1}`,
      rank: index + 1,
      song: {
        neteaseSongId: `${prefix}-${index + 1}`,
        name: `${namePrefix} ${index + 1}`,
        artistNames: [`歌手 ${index + 1}`],
        albumName: "测试专辑",
        coverUrl: null,
        sources: ["liked"],
        tags: ["calm", "focused", "playable"]
      },
      score: 90 - index,
      reason: "AI recommendation reason",
      streamUrl: `https://music.example/${prefix}-${index + 1}.mp3`,
      embedUrl: `https://music.163.com/outchain/player?type=2&id=${prefix}-${index + 1}`,
      playbackUrl: `https://music.163.com/#/song?id=${prefix}-${index + 1}`
    }))
  };
}
