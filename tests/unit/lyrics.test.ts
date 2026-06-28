import { describe, expect, it } from "vitest";
import { findActiveLyricLineIndex, parseSyncedLyrics } from "@/lib/lyrics/lyrics";

describe("lyrics helpers", () => {
  it("parses timestamped lyrics and merges translated lines by timestamp", () => {
    const parsed = parseSyncedLyrics({
      lyric: "[00:01.20]Do we say what we mean\n[00:05.00]Why was everyone leaving",
      translatedLyric: "[00:01.20]我们说的是我们想说的吗\n[00:05.00]为什么每个人都要离去"
    });

    expect(parsed).toEqual([
      {
        time: 1.2,
        text: "Do we say what we mean",
        translation: "我们说的是我们想说的吗"
      },
      {
        time: 5,
        text: "Why was everyone leaving",
        translation: "为什么每个人都要离去"
      }
    ]);
  });

  it("finds the active lyric line for the current playback time", () => {
    const lines = parseSyncedLyrics({
      lyric: "[00:01.00]第一句\n[00:04.50]第二句\n[00:08.00]第三句"
    });

    expect(findActiveLyricLineIndex(lines, 0)).toBe(-1);
    expect(findActiveLyricLineIndex(lines, 1.2)).toBe(0);
    expect(findActiveLyricLineIndex(lines, 6)).toBe(1);
    expect(findActiveLyricLineIndex(lines, 12)).toBe(2);
  });
});
