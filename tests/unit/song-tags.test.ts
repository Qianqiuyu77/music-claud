import { describe, expect, it } from "vitest";
import { classifySongTags, ensureDistinctVisibleSongTags, extractNeteaseWikiTags, tagLabel, visibleSongTags } from "@/lib/recommendation/songTags";

describe("song tag classifier", () => {
  it("adds distinct theme tags from observable title keywords", () => {
    expect(tagsFor("黑夜问白天 (Live)")).toEqual(expect.arrayContaining(["night", "live"]));
    expect(tagsFor("简单爱")).toEqual(expect.arrayContaining(["love_song"]));
    expect(tagsFor("回到过去")).toEqual(expect.arrayContaining(["nostalgic"]));
    expect(tagsFor("找自己")).toEqual(expect.arrayContaining(["introspective"]));
  });

  it("translates theme tags into Chinese labels", () => {
    expect(tagLabel("night")).toBe("夜晚");
    expect(tagLabel("love_song")).toBe("情歌");
    expect(tagLabel("nostalgic")).toBe("怀旧");
    expect(tagLabel("introspective")).toBe("自省");
    expect(tagLabel("artist:周杰伦")).toBe("歌手：周杰伦");
    expect(tagLabel("album:叶惠美")).toBe("专辑：叶惠美");
  });

  it("marks AI-prefixed tags with an AI label", () => {
    expect(tagLabel("ai:mood:calm")).toBe("AI 安静");
    expect(tagLabel("ai:scene:focus")).toBe("AI 专注");
    expect(tagLabel("ai:tagged")).toBe("AI 已打标");
    expect(visibleSongTags(["liked", "ai:mood:calm", "ai:tagged"]).map(({ label }) => label)).toEqual(expect.arrayContaining(["AI 安静"]));
  });

  it("adds useful category tags from stable NetEase metadata", () => {
    const tags = classifySongTags({
      name: "普通歌曲",
      artistNames: ["歌手 A", "歌手 B"],
      albumName: "普通专辑",
      durationMs: 210000,
      popularity: 82,
      publishTime: Date.UTC(2024, 0, 1),
      sources: ["liked", "playlist"],
      streamUrl: "https://music.example/song.mp3",
      hasMv: true
    });

    expect(tags).toEqual(
      expect.arrayContaining(["core_collection", "mainstream", "standard_song", "recent_release", "collaboration", "mv_available"])
    );
    expect(tagLabel("core_collection")).toBe("核心收藏");
    expect(tagLabel("mainstream")).toBe("主流热度");
  });

  it("keeps visible tags different when songs share source and language but differ in metadata", () => {
    const shortLow = classifySongTags({
      name: "测试歌曲一",
      artistNames: ["歌手"],
      albumName: "测试专辑",
      durationMs: 120000,
      popularity: 35,
      sources: ["playlist"],
      streamUrl: "https://music.example/short.mp3"
    });
    const longHot = classifySongTags({
      name: "测试歌曲二",
      artistNames: ["歌手"],
      albumName: "测试专辑",
      durationMs: 330000,
      popularity: 93,
      sources: ["playlist"],
      streamUrl: "https://music.example/long.mp3"
    });

    expect(visibleTags(shortLow)).toEqual(expect.arrayContaining(["deep_cut", "short_song"]));
    expect(visibleTags(longHot)).toEqual(expect.arrayContaining(["popular", "long_song"]));
    expect(visibleTags(shortLow)).not.toEqual(visibleTags(longHot));
  });

  it("extracts NetEase wiki categories into displayable song tags", () => {
    const tags = extractNeteaseWikiTags({
      data: {
        blocks: [
          {
            code: "SONG_PLAY_ABOUT_SONG_BASIC",
            creatives: [
              wikiCreative("曲风", ["流行-华语流行", "R&B"]),
              wikiCreative("推荐标签", ["苦情", "悲伤"]),
              wikiCreative("语种", ["华语"])
            ]
          }
        ]
      }
    });

    expect(tags).toEqual(expect.arrayContaining(["style:华语流行", "style:R&B", "mood:苦情", "mood:悲伤", "chinese", "melancholy"]));
    expect(visibleSongTags(["liked", "playlist", "playable", "focused", ...tags]).slice(0, 4)).toEqual([
      { tag: "style:华语流行", label: "华语流行" },
      { tag: "style:R&B", label: "R&B" },
      { tag: "mood:苦情", label: "苦情" },
      { tag: "mood:悲伤", label: "悲伤" }
    ]);
  });

  it("keeps common source tags behind meaningful categories in the visible list", () => {
    const visible = visibleTags([
      "liked",
      "playlist",
      "playable",
      "focused",
      "core_collection",
      "rediscovered",
      "popular",
      "standard_song",
      "style:未来浩室",
      "style:欧美流行",
      "mood:孤独"
    ]);

    expect(visible.slice(0, 3)).toEqual(["style:未来浩室", "style:欧美流行", "mood:孤独"]);
    expect(visible).not.toContain("liked");
    expect(visible).not.toContain("playable");
  });

  it("adds observable fallback tags when a recommendation batch would show duplicate categories", () => {
    const commonTags = ["liked", "playlist", "playable", "focused", "core_collection", "style:华语流行", "mood:悲伤"];
    const songs = ensureDistinctVisibleSongTags([
      {
        name: "空白格",
        artistNames: ["蔡健雅"],
        albumName: "Goodbye & Hello",
        tags: commonTags
      },
      {
        name: "钟无艳",
        artistNames: ["谢安琪"],
        albumName: "Binary",
        tags: commonTags
      }
    ]);

    const visibleSignatures = songs.map((song) => visibleSongTags(song.tags).map(({ label }) => label).join("|"));

    expect(new Set(visibleSignatures).size).toBe(songs.length);
    expect(songs[0].tags).toContain("artist:蔡健雅");
    expect(songs[1].tags).toContain("artist:谢安琪");
  });

  it("keeps fallback difference visible even when shared wiki categories fill the tag limit", () => {
    const commonTags = [
      "liked",
      "playlist",
      "playable",
      "focused",
      "style:华语流行",
      "style:R&B",
      "style:抒情",
      "mood:悲伤",
      "mood:浪漫",
      "mood:思念"
    ];
    const songs = ensureDistinctVisibleSongTags([
      {
        name: "第一首",
        artistNames: ["歌手甲"],
        albumName: "同类专辑",
        tags: commonTags
      },
      {
        name: "第二首",
        artistNames: ["歌手乙"],
        albumName: "同类专辑",
        tags: commonTags
      }
    ]);

    const visible = songs.map((song) => visibleSongTags(song.tags).map(({ tag }) => tag));

    expect(visible[0]).toContain("artist:歌手甲");
    expect(visible[1]).toContain("artist:歌手乙");
    expect(new Set(visible.map((tags) => tags.join("|"))).size).toBe(songs.length);
  });

  it("gives every song a visible metadata category even without NetEase wiki tags", () => {
    const songs = ensureDistinctVisibleSongTags([
      {
        name: "晴天",
        artistNames: ["周杰伦"],
        albumName: "叶惠美",
        durationMs: 269000,
        popularity: 95,
        tags: ["liked", "playlist", "playable", "focused", "chinese", "popular"]
      },
      {
        name: "富士山下",
        artistNames: ["陈奕迅"],
        albumName: "What's Going On...?",
        durationMs: 259000,
        popularity: 90,
        tags: ["liked", "playlist", "playable", "focused", "chinese", "popular"]
      },
      {
        name: "空白格",
        artistNames: ["蔡健雅"],
        albumName: "Goodbye & Hello",
        durationMs: 251000,
        popularity: 91,
        tags: ["liked", "playlist", "playable", "focused", "chinese", "popular"]
      }
    ]);

    const visible = songs.map((song) => visibleSongTags(song.tags).map(({ tag }) => tag));

    expect(visible.every((tags) => tags.some((tag) => tag.startsWith("artist:")))).toBe(true);
    expect(new Set(visible.map((tags) => tags.join("|"))).size).toBe(songs.length);
  });

  it("adds a visible metadata category to every song even when base categories already differ", () => {
    const songs = ensureDistinctVisibleSongTags([
      {
        name: "夜曲",
        artistNames: ["周杰伦"],
        albumName: "十一月的萧邦",
        durationMs: 226000,
        popularity: 96,
        tags: ["liked", "playable", "night", "rap", "chinese", "popular"]
      },
      {
        name: "旅行的意义",
        artistNames: ["陈绮贞"],
        albumName: "华丽的冒险",
        durationMs: 258000,
        popularity: 88,
        tags: ["playlist", "playable", "folk", "bright", "chinese", "mainstream"]
      }
    ]);

    const visible = songs.map((song) => visibleSongTags(song.tags).map(({ tag }) => tag));

    expect(visible[0]).toContain("artist:周杰伦");
    expect(visible[1]).toContain("artist:陈绮贞");
  });

  it("uses album or song metadata when artist alone cannot make song tags different", () => {
    const songs = ensureDistinctVisibleSongTags([
      {
        name: "可爱女人",
        artistNames: ["周杰伦"],
        albumName: "Jay",
        tags: ["liked", "playable", "love_song", "chinese", "popular"]
      },
      {
        name: "晴天",
        artistNames: ["周杰伦"],
        albumName: "叶惠美",
        tags: ["playlist", "playable", "bright", "chinese", "popular"]
      }
    ]);

    const visible = songs.map((song) => visibleSongTags(song.tags).map(({ tag }) => tag));

    expect(visible[0]).toContain("album:Jay");
    expect(visible[1]).toContain("album:叶惠美");
  });

  it("keeps each song's unique metadata tag visible when shared wiki categories fill the tag list", () => {
    const commonTags = [
      "liked",
      "playlist",
      "playable",
      "style:华语流行",
      "style:R&B",
      "style:流行摇滚",
      "style:抒情流行",
      "style:民谣流行",
      "style:独立流行",
      "mood:怀旧",
      "mood:悲伤"
    ];
    const songs = ensureDistinctVisibleSongTags([
      {
        name: "第一首真实歌",
        artistNames: ["歌手甲"],
        albumName: "同类专辑",
        tags: commonTags
      },
      {
        name: "第二首真实歌",
        artistNames: ["歌手乙"],
        albumName: "同类专辑",
        tags: commonTags
      }
    ]);

    const visible = songs.map((song) => visibleSongTags(song.tags).map(({ tag }) => tag));

    expect(visible[0]).toContain("artist:歌手甲");
    expect(visible[1]).toContain("artist:歌手乙");
    expect(new Set(visible.map((tags) => tags.join("|"))).size).toBe(songs.length);
  });
});

function tagsFor(name: string) {
  return classifySongTags({
    name,
    artistNames: ["周杰伦"],
    albumName: "测试专辑",
    durationMs: 210000,
    popularity: 75,
    sources: ["liked"],
    streamUrl: "https://music.example/song.mp3"
  });
}

function visibleTags(tags: string[]) {
  return visibleSongTags(tags).map(({ tag }) => tag);
}

function wikiCreative(title: string, resourceTitles: string[]) {
  return {
    uiElement: { mainTitle: { title } },
    resources: resourceTitles.map((resourceTitle) => ({
      uiElement: { mainTitle: { title: resourceTitle } }
    }))
  };
}
