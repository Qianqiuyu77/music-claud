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
    expect(screen.getByText("等待曲库同步")).toBeInTheDocument();
    expect(container.querySelector(".player-app")).toBeInTheDocument();
    expect(container.querySelector(".control-rail")).not.toBeInTheDocument();
    expect(screen.queryByText("网易云曲库")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /网易云 Cookie/i })).not.toBeInTheDocument();

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
    expect(screen.queryByText("6958 首真实候选歌")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync")).toHaveLength(0);

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
    fireEvent.click(screen.getByRole("button", { name: "写代码" }));
    fireEvent.change(screen.getByRole("textbox", { name: /听歌场景/i }), { target: { value: "别太困，有点律动" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/recommendations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            prompt: "别太困，有点律动",
            text: "别太困，有点律动",
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
    fireEvent.change(screen.getByRole("textbox", { name: /听歌场景/i }), { target: { value: "想听一点安静的歌" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    await waitFor(() => expect(playMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    expect(screen.getByRole("textbox", { name: /听歌场景/i })).toHaveValue("");

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
    fireEvent.change(screen.getByRole("textbox", { name: /听歌场景/i }), { target: { value: "想听一点安静的歌" } });
    fireEvent.click(screen.getByRole("button", { name: /生成推荐/i }));

    expect(await screen.findByText("DeepSeek 调用失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "输入场景" }));
    expect(screen.getByRole("textbox", { name: /听歌场景/i })).toHaveValue("想听一点安静的歌");

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
    expect(window.sessionStorage.getItem("latestRecommendationResult")).not.toContain("默认我喜欢随机播放");

    fetchMock.mockRestore();
  });

  it("renders the standalone recommendation flow page from the latest saved result", async () => {
    window.sessionStorage.setItem("latestRecommendationResult", JSON.stringify(recommendationResult));

    render(<RecommendationFlowPage />);

    expect(await screen.findByRole("heading", { name: "推荐生成流程" })).toBeInTheDocument();
    expect(screen.getByText("数据流节点图")).toBeInTheDocument();
    expect(screen.getByText("15 个节点")).toBeInTheDocument();
    expect(screen.getByText("用户输入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /02 推荐接口请求/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /05 本地曲库读取/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /06 播放冷却过滤/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /08 来源召回/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /10 标签增强/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /13 本地补齐/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /14 可播放队列/ })).toBeInTheDocument();
    expect(screen.getByText("节点输入")).toBeInTheDocument();
    expect(screen.getByText("处理动作")).toBeInTheDocument();
    expect(screen.getByText("节点输出")).toBeInTheDocument();
    expect(screen.getByText("AI 标签覆盖率")).toBeInTheDocument();
    expect(screen.getByText("完整播放 7 天冷却")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /03 偏好摘要或跳过/ }));
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("缺少画像，已跳过");
    expect(screen.getByRole("region", { name: "当前节点详情" })).not.toHaveTextContent("已生成 AI 偏好摘要");

    fireEvent.click(screen.getByRole("button", { name: /11 硬过滤/ }));
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("排除 1 首");
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("高能应排除歌曲");

    fireEvent.click(screen.getByRole("button", { name: /12 AI 重排/ }));
    expect(screen.getByRole("region", { name: "当前节点详情" })).toHaveTextContent("AI 原始推荐理由");
    expect(screen.getByText("AI 完整返回")).toBeInTheDocument();
    expect(screen.getAllByText("请求输入").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/你是音乐推荐意图解析器/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/写代码/).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("AI 候选池 50 首").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 选中 1 首").length).toBeGreaterThan(0);
    expect(screen.getAllByText("本地补齐 1 首").length).toBeGreaterThan(0);
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
    expect(screen.getByRole("button", { name: "登录后同步" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "登录后打标" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /听歌场景/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "输入场景" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Cookie" })).toBeDisabled();
    expect(container.querySelector(".control-rail .music-sidebar")).toBeInTheDocument();
    expect(container.querySelector(".control-rail .strategy-panel")).toBeInTheDocument();

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
    expect(screen.getByText("已同步")).toBeInTheDocument();
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
      expect(container.querySelector(".player-shell")).toHaveTextContent("第一页歌曲 1");
    });
    fireEvent.click(screen.getByRole("button", { name: "打开播放队列" }));
    expect(await screen.findByRole("dialog", { name: "播放队列" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /第一页歌曲 10/ }));

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
      expect(screen.getAllByText("第二页歌曲 1").length).toBeGreaterThan(0);
    });

    fetchMock.mockRestore();
  });

  it("saves item feedback from the player", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      return new Response(JSON.stringify({ ok: true }));
    });
    render(
      <RecommendationPanel
        prompt="写代码"
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
    expect(await screen.findByText("已记录喜欢")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "标记喜欢 真实歌曲 A" })).toHaveAttribute("aria-pressed", "true");

    fetchMock.mockRestore();
  });

  it("shows category tags and keeps the queue behind a button", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="写代码"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    expect(container.querySelector(".player-shell")).toHaveTextContent("真实歌曲 A");
    expect(screen.getAllByText("纯音乐").length).toBeGreaterThan(0);
    expect(screen.getAllByText("安静").length).toBeGreaterThan(0);
    expect(container.querySelector(".lyric-panel")).not.toBeInTheDocument();
    expect(container.querySelector(".player-insight")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "推荐逻辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "输入场景" })).toHaveTextContent("我想听...");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/lyrics"))).toBe(false);
    expect(screen.queryByText("2 首推荐")).not.toBeInTheDocument();
    expect(screen.queryByText("2 首可播放")).not.toBeInTheDocument();
    expect(screen.queryByText("持续推荐中")).not.toBeInTheDocument();
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
        prompt="写代码"
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
        prompt="写代码"
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
    expect(screen.getByText("我喜欢随机")).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it("shows a seekable playback timeline in the immersive player", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const { container } = render(
      <RecommendationPanel
        prompt="写代码"
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
        prompt="写代码"
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

  it("loads synced lyrics when the user taps the cover and highlights the current line", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("/api/lyrics")) {
        return new Response(
          JSON.stringify({
            lines: [
              { time: 0, text: "前一句歌词" },
              { time: 40, text: "当前这一句歌词", translation: "current line" },
              { time: 80, text: "下一句歌词" }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    const { container } = render(
      <RecommendationPanel
        prompt="写代码"
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

    expect(await screen.findByText("当前这一句歌词")).toBeInTheDocument();
    expect(container.querySelector(".lyric-line.is-active")).toHaveTextContent("当前这一句歌词");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/lyrics?id=101"))).toBe(true);

    fetchMock.mockRestore();
  });

  it("highlights the first lyric line before the first timestamp starts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("/api/lyrics")) {
        return new Response(
          JSON.stringify({
            lines: [
              { time: 20, text: "还没唱到的第一句" },
              { time: 40, text: "第二句歌词" }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ ok: true }));
    });
    const { container } = render(
      <RecommendationPanel
        prompt="写代码"
        onPromptChange={() => undefined}
        onRecommend={() => undefined}
        loading={false}
        result={queuePlaybackResult}
        libraryCounts={{ songs: 2, partialFailures: 0 }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "切换到歌词" }));

    expect(await screen.findByText("还没唱到的第一句")).toBeInTheDocument();
    expect(container.querySelector(".lyric-line.is-active")).toHaveTextContent("还没唱到的第一句");

    fetchMock.mockRestore();
  });

  it("opens the companion chat from the player controls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="写代码"
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

  it("opens a visual recommendation flow with AI filtering and ranking details", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(
      <RecommendationPanel
        prompt="写代码"
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
    expect(screen.getAllByText("硬过滤").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 重排").length).toBeGreaterThan(0);
    expect(screen.getByText("高能应排除歌曲")).toBeInTheDocument();
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
        prompt="写代码"
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
    expect(screen.queryByText("可播放歌曲")).not.toBeInTheDocument();
    expect(screen.queryByText("2 首")).not.toBeInTheDocument();
    expect(screen.getByText("推荐来源").parentElement).toHaveTextContent("红心相似、歌单");
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
    input: { prompt: "写代码", requested: 2, excludedPlayedIds: [] },
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
      excludedByTags: [{ id: "999", name: "高能应排除歌曲", artistNames: ["歌手 C"], matchedTags: ["energy:high"] }],
      cooldownExcluded: [{ id: "888", name: "刚听过的歌", artistNames: ["歌手 D"], reason: "完整播放 7 天冷却", cooldownDays: 7 }]
    },
    ranking: {
      localRankedCount: 3,
      afterTagFilterCount: 2,
      aiRerankedCount: 2,
      finalCount: 2,
      topLocal: [],
      final: [
        { id: "101", name: "真实歌曲 A", artistNames: ["歌手 A"], score: 8.4, tags: ["calm"], reason: "来自真实红心歌，适合当前场景。", rank: 1 },
        { id: "102", name: "真实歌曲 B", artistNames: ["歌手 B"], score: 7.8, tags: ["rock"], reason: "来自真实歌单，和本轮需求接近。", rank: 2 }
      ]
    },
    ai: {
      calls: [
        {
          id: "preference-skipped-1",
          stage: "preference",
          title: "AI 偏好摘要已跳过",
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
              { role: "system", content: "你是音乐推荐意图解析器，只返回 JSON。" },
              { role: "user", content: JSON.stringify({ input: "写代码", profileSummary: "偏好摘要" }) }
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
              { role: "system", content: "你是私人音乐推荐排序器，只返回 JSON。" },
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
      reason: "来自真实红心歌，适合当前场景。",
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
      reason: "来自真实歌单，和本轮需求接近。",
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
        { id: "101", name: "真实歌曲 A", artistNames: ["歌手 A"], score: 91.2, tags: ["calm"], reason: "本地 Top 候选。", rank: 1 },
        { id: "102", name: "真实歌曲 B", artistNames: ["歌手 B"], score: 86.7, tags: ["rock"], reason: "本地补齐候选。", rank: 2 }
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

const firstPageResult = pageResult("first", "第一页歌曲", true);
const secondPageResult = pageResult("second", "第二页歌曲", false);

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
    input: { prompt: "默认我喜欢随机播放", requested: 2, excludedPlayedIds: [] },
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
      reason: "来自你的我喜欢随机播放，不是 AI 推荐。",
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
      reason: "来自你的我喜欢随机播放，不是 AI 推荐。",
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
      reason: "AI 推荐理由。",
      streamUrl: `https://music.example/${prefix}-${index + 1}.mp3`,
      embedUrl: `https://music.163.com/outchain/player?type=2&id=${prefix}-${index + 1}`,
      playbackUrl: `https://music.163.com/#/song?id=${prefix}-${index + 1}`
    }))
  };
}
