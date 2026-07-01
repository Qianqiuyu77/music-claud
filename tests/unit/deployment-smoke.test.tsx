import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import CookieTestPage from "@/app/admin/cookie-test/page";
import { GET as defaultQueueGet } from "@/app/api/default-queue/route";
import { GET as loginDiagnosticsGet } from "@/app/api/login/diagnostics/route";
import { POST as recommendationsPost } from "@/app/api/recommendations/route";
import { GET as tagsQueueGet } from "@/app/api/tags/queue/route";
import type { AppDatabase } from "@/lib/db/client";
import { getMusicRepositoryForApp, resetAppServicesForTests } from "@/lib/appServices";
import { TaggingQueueRepository } from "@/lib/repositories/taggingQueueRepository";
import type { CandidateSong } from "@/lib/recommendation/types";
import { createSessionCookieValue } from "@/lib/user/sessionCookie";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => []
  }))
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  })
}));

describe("deployment route smoke checks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the consumer and cookie-test pages without route-level crashes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/login/diagnostics") {
        return new Response(JSON.stringify({ configured: false, valid: false, cookiePreview: "", account: null }));
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const home = render(<HomePage />);
    expect(home.container.querySelector(".player-app")).toBeInTheDocument();

    const cookieTest = render(await CookieTestPage());
    expect(cookieTest.container.querySelector(".cookie-test-shell")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Cookie 摘要")).toBeInTheDocument());
  });

  it("blocks non-owner browser sessions from the admin cookie-test page", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const headers = await import("next/headers");
    const navigation = await import("next/navigation");

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      vi.mocked(headers.cookies).mockResolvedValue({
        getAll: () => [{ name: "ai_music_user", value: "2" }]
      } as Awaited<ReturnType<typeof headers.cookies>>);

      await expect(CookieTestPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(navigation.notFound).toHaveBeenCalled();
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("smokes critical API routes with expected deployment statuses", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    delete process.env.NETEASE_COOKIE;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [songFixture("owner-smoke-liked")]);
      const songId = repository.upsertCandidateSong(songFixture("owner-smoke-tag-job"));
      new TaggingQueueRepository(db).enqueueMissingTags([songId], "smoke");
      const ownerCookie = userCookie(1);
      const friendCookie = userCookie(2);

      const diagnostics = await loginDiagnosticsGet(new Request("http://localhost/api/login/diagnostics", { headers: { cookie: ownerCookie } }));
      expect(diagnostics.status).toBe(200);

      const defaultQueue = await defaultQueueGet(new Request("http://localhost/api/default-queue?limit=1", { headers: { cookie: ownerCookie } }));
      expect(defaultQueue.status).toBe(200);

      const recommendationMissingAuth = await recommendationsPost(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          headers: { cookie: friendCookie },
          body: JSON.stringify({ prompt: "quiet focus" })
        })
      );
      expect(recommendationMissingAuth.status).toBe(401);

      const recommendationBadPrompt = await recommendationsPost(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          headers: { cookie: ownerCookie },
          body: JSON.stringify({ prompt: "   " })
        })
      );
      expect(recommendationBadPrompt.status).toBe(400);

      const tagQueueOwner = await tagsQueueGet(new Request("http://localhost/api/tags/queue?limit=5", { headers: { cookie: ownerCookie } }));
      expect(tagQueueOwner.status).toBe(200);

      const tagQueueFriend = await tagsQueueGet(new Request("http://localhost/api/tags/queue?limit=5", { headers: { cookie: friendCookie } }));
      expect(tagQueueFriend.status).toBe(404);
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });
});

function userCookie(userId: number): string {
  return `ai_music_user=${createSessionCookieValue(userId)}`;
}

function songFixture(neteaseSongId: string): CandidateSong {
  return {
    neteaseSongId,
    name: "Smoke Song",
    artistNames: ["Smoke Artist"],
    albumName: "Smoke Album",
    coverUrl: null,
    streamUrl: `https://music.example/${neteaseSongId}.mp3`,
    durationMs: 180000,
    popularity: 70,
    sources: ["liked"],
    tags: ["scene:focus", "mood:calm", "ai:tagged"],
    recentPlayCount: 0,
    daysSinceLastPlayed: 30,
    feedback: []
  };
}
