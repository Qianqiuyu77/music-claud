import { expect, test } from "@playwright/test";

test("player page stays clean and generates a playable AI-ranked queue", async ({ page }) => {
  test.setTimeout(120000);

  await page.goto("/");

  await expect(page.getByRole("textbox", { name: /听歌场景/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "输入场景" })).toBeVisible();
  await expect(page.getByText("网易云曲库")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /网易云 Cookie/i })).toHaveCount(0);

  await page.getByRole("button", { name: "输入场景" }).click();
  await expect(page.getByRole("dialog", { name: "场景推荐" })).toBeVisible();
  await page.getByRole("textbox", { name: /听歌场景/i }).fill("写代码，安静，少人声，不要太吵");
  await page.getByRole("button", { name: /生成推荐/i }).click();
  await expect(page.getByRole("dialog", { name: "场景推荐" })).not.toBeVisible();

  await expect(page.getByText("正在播放")).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".player-dock .source-pill")).toHaveText("AI 选中", { timeout: 90000 });
  const desktopLayout = await page.evaluate(() => ({
    htmlHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    appHeight: document.querySelector(".music-app.player-app")?.getBoundingClientRect().height ?? 0
  }));
  expect(desktopLayout.htmlHeight).toBeLessThanOrEqual(desktopLayout.viewportHeight + 2);
  expect(desktopLayout.appHeight).toBeLessThanOrEqual(desktopLayout.viewportHeight + 2);
  await expect(page.locator(".player-shell audio[src]")).toBeAttached();
  await expect(page.locator(".player-shell audio")).toHaveAttribute("src", /^\/api\/playback\?id=/);
  await expect(page.locator(".lyric-panel")).toHaveCount(0);
  await expect(page.getByText(/歌词加载中|暂无可同步歌词/)).toHaveCount(0);
  const playbackProbe = await page.evaluate(async () => {
    const audio = document.querySelector("audio");
    const response = await fetch(audio?.getAttribute("src") ?? "", { headers: { range: "bytes=0-1023" } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      byteLength: bytes.length,
      header: Array.from(bytes.slice(0, 3))
    };
  });
  expect(playbackProbe).toEqual(
    expect.objectContaining({
      status: 206,
      byteLength: 1024,
      header: [73, 68, 51]
    })
  );
  expect(playbackProbe.contentType).toContain("audio/");
  await expect(page.locator(".player-shell .song-tag-list span")).not.toHaveCount(0);
  await expect(page.locator(".song-card")).toHaveCount(0);
  await expect(page.getByText(/Fits|Included|signals|freshness/i)).toHaveCount(0);
  await expect(page.getByText(/首推荐|首可播放|持续推荐中|已到队列末尾/)).toHaveCount(0);
  await expect(page.locator(".player-summary")).toHaveCount(0);

  await expect(page.getByRole("button", { name: "推荐逻辑" })).toBeVisible();
  await page.getByRole("button", { name: "推荐逻辑" }).click();
  await expect(page.getByRole("dialog", { name: "推荐逻辑" })).toBeVisible();
  await expect(page.getByText("用户输入")).toBeVisible();
  await expect(page.locator(".flow-summary-band").getByText("AI 意图解析")).toBeVisible();
  await expect(page.getByText("硬过滤", { exact: true })).toBeVisible();
  await expect(page.getByText("AI 重排", { exact: true })).toBeVisible();
  const flowPagePromise = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "打开完整流程页" }).click();
  const flowPage = await flowPagePromise;
  await flowPage.waitForLoadState("domcontentloaded");
  await expect(flowPage.getByRole("heading", { name: "推荐生成流程" })).toBeVisible();
  await expect(flowPage.getByText("数据流节点图")).toBeVisible();
  await expect(flowPage.getByText("15 个节点")).toBeVisible();
  await expect(flowPage.getByRole("button", { name: /05 本地曲库读取/ })).toBeVisible();
  await expect(flowPage.getByRole("button", { name: /06 播放冷却过滤/ })).toBeVisible();
  await expect(flowPage.getByRole("button", { name: /13 本地补齐/ })).toBeVisible();
  await expect(flowPage.getByRole("button", { name: /14 可播放队列/ })).toBeVisible();
  await expect(flowPage.getByText("AI 标签覆盖率")).toBeVisible();
  await flowPage.getByRole("button", { name: /12 AI 重排/ }).click();
  await expect(flowPage.getByRole("region", { name: "当前节点详情" })).toContainText("关联 AI 请求与返回");
  await expect(flowPage.getByText("AI 完整返回")).toBeVisible();
  await expect(flowPage.locator(".ai-code-block pre").first()).not.toBeEmpty();
  await flowPage.close();
  await page.getByRole("button", { name: "关闭推荐逻辑" }).click();

  await page.getByRole("button", { name: "打开播放队列" }).click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).toBeVisible();
  await expect(page.locator(".queue-row")).toHaveCount(12);
  await expect(page.locator(".queue-index")).toHaveCount(0);
  await expect(page.getByText("本轮推荐")).toHaveCount(0);
  await page.locator(".queue-row").nth(1).click();
  await expect(page.getByRole("dialog", { name: "播放队列" })).not.toBeVisible();
  await expect(page.locator(".player-shell audio[src]")).toBeAttached();
  await expect(page.locator(".player-shell audio")).toHaveAttribute("src", /^\/api\/playback\?id=/);
  await expect(page.getByText("在网易云打开").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /标记喜欢/i }).first()).toHaveAttribute("aria-pressed", "false");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    htmlHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    appWidth: document.querySelector(".music-app.player-app")?.getBoundingClientRect().width ?? 0,
    viewportWidth: window.innerWidth
  }));
  expect(mobileLayout.htmlHeight).toBeLessThanOrEqual(mobileLayout.viewportHeight + 2);
  expect(mobileLayout.appWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth + 2);
});

test("admin page owns NetEase data controls", async ({ page }) => {
  await page.goto("/admin");

  await expect(page.getByText(/网易云已连接|网易云登录|正在连接/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "网易云曲库" })).toBeVisible();
  await expect(page.getByRole("button", { name: /同步网易云数据|登录后同步|正在同步/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /扩充曲库|登录后扩充|正在扩充/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /补充 AI 标签|登录后打标|正在打标/ })).toBeVisible();
  await expect(page.getByText("本轮来源")).toBeVisible();
});
