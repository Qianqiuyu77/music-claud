import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/lyrics/route";
import { resetLyricsServicesForTests, setLyricsServicesForTests } from "@/lib/lyrics/lyricsService";

afterEach(() => {
  resetLyricsServicesForTests();
});

describe("lyrics API", () => {
  it("returns parsed lyric lines for a song", async () => {
    setLyricsServicesForTests({
      getLyrics: async (songId) => [
        {
          time: 1.2,
          text: `第一句 ${songId}`,
          translation: "First line"
        }
      ]
    });

    const response = await GET(new Request("http://localhost/api/lyrics?id=436514312"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      songId: "436514312",
      lines: [
        {
          time: 1.2,
          text: "第一句 436514312",
          translation: "First line"
        }
      ]
    });
  });

  it("rejects requests without a song id", async () => {
    const response = await GET(new Request("http://localhost/api/lyrics"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "缺少歌曲 ID。"
    });
  });
});
