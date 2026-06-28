import type { CandidateSourceName } from "./types";

export type SongTagMetadata = {
  name?: string | null;
  artistNames?: string[];
  albumName?: string | null;
  durationMs?: number | null;
  popularity?: number | null;
  publishTime?: number | null;
  sources?: CandidateSourceName[];
  streamUrl?: string | null;
  hasMv?: boolean;
};

const sourceTags = new Set(["liked", "playlist", "recent", "exploration"]);
const stateTags = new Set(["playable", "copyright_limited"]);
const genericStyleSegments = new Set(["曲风", "流行"]);
const reasonTagPriority = [
  "pop",
  "calm",
  "focused",
  "instrumental",
  "night",
  "love_song",
  "nostalgic",
  "introspective",
  "bright",
  "melancholy",
  "rock",
  "electronic",
  "folk",
  "rap",
  "live",
  "remix",
  "ost",
  "acg",
  "chinese",
  "western",
  "japanese",
  "korean",
  "popular",
  "mainstream",
  "deep_cut",
  "core_collection",
  "rediscovered",
  "fresh_in_library",
  "short_song",
  "standard_song",
  "epic_length",
  "long_song"
];

export type VisibleTagSong = {
  name?: string | null;
  artistNames?: string[];
  albumName?: string | null;
  durationMs?: number | null;
  popularity?: number | null;
  tags: string[];
};

export function stripAiTagPrefix(tag: string) {
  return tag.startsWith("ai:") ? tag.slice(3) : tag;
}

export function hasSongTag(tags: string[], tag: string) {
  return tags.includes(tag) || tags.includes(`ai:${tag}`);
}

export function matchingSongTags(tags: string[], expectedTags: string[]) {
  return expectedTags.filter((tag) => hasSongTag(tags, tag));
}

export function classifySongTags(metadata: SongTagMetadata): string[] {
  const tags = new Set<string>();
  const sources = metadata.sources ?? [];
  const artistCount = metadata.artistNames?.length ?? 0;
  const duration = metadata.durationMs ?? 0;
  const popularity = metadata.popularity ?? null;
  const text = normalizeText([metadata.name, metadata.albumName, ...(metadata.artistNames ?? [])].join(" "));

  for (const source of sources) tags.add(source);
  tags.add(metadata.streamUrl ? "playable" : "copyright_limited");

  if (sources.includes("recent")) tags.add("familiar");
  if (sources.includes("liked") || sources.includes("playlist")) tags.add("focused");
  if (sources.includes("liked") && sources.includes("playlist")) tags.add("core_collection");
  if (sources.includes("playlist") && sources.includes("recent") && !sources.includes("liked")) tags.add("fresh_in_library");
  if (sources.includes("liked") && !sources.includes("recent")) tags.add("rediscovered");

  if (popularity !== null && popularity >= 90) tags.add("popular");
  if (popularity !== null && popularity >= 70 && popularity < 90) tags.add("mainstream");
  if (popularity !== null && popularity <= 45) tags.add("deep_cut");

  if (duration > 0 && duration <= 150000) tags.add("short_song");
  if (duration > 150000 && duration < 300000) tags.add("standard_song");
  if (duration >= 300000) tags.add("long_song");
  if (duration >= 420000) tags.add("epic_length");

  addReleaseEraTag(tags, metadata.publishTime);
  if (artistCount > 1) tags.add("collaboration");
  if (artistCount === 1) tags.add("solo_artist");
  if (metadata.hasMv) tags.add("mv_available");

  addLanguageTag(tags, text);
  addKeywordTags(tags, text);

  if (tags.has("instrumental") || tags.has("folk")) tags.add("calm");
  if (tags.has("electronic") || tags.has("rock") || tags.has("rap")) tags.add("high_energy");
  if (!tags.has("calm") && !tags.has("focused") && !tags.has("high_energy")) tags.add("balanced");
  if (tags.size < 4) tags.add("open");

  return Array.from(tags);
}

export function tagLabel(tag: string) {
  const isAiTag = tag.startsWith("ai:");
  const normalizedTag = stripAiTagPrefix(tag);
  if (normalizedTag === "tagged") return "AI 已打标";

  const labels: Record<string, string> = {
    "scene:focus": "专注",
    "scene:commute": "通勤",
    "scene:workout": "运动",
    "scene:sleep": "睡前",
    "scene:study": "学习",
    "scene:party": "聚会",
    "scene:walk": "散步",
    "scene:travel": "旅行",
    "scene:alone": "独处",
    "scene:background": "背景音乐",
    "mood:calm": "安静",
    "mood:focused": "专注",
    "mood:bright": "明亮",
    "mood:melancholy": "低落",
    "mood:romantic": "浪漫",
    "mood:nostalgic": "怀旧",
    "mood:healing": "治愈",
    "mood:lonely": "孤独",
    "mood:confident": "自信",
    "mood:dreamy": "梦幻",
    "energy:low": "低能量",
    "energy:medium": "中等能量",
    "energy:high": "高能量",
    "energy:rising": "渐强",
    "energy:steady": "稳定",
    "vocal:less_vocal": "少人声",
    "vocal:vocal_ok": "有人声",
    "vocal:instrumental": "纯音乐",
    "vocal:strong_vocal": "人声突出",
    "lang:zh": "华语",
    "lang:en": "英语",
    "lang:ja": "日语",
    "lang:ko": "韩语",
    "lang:mixed": "多语种",
    "genre:pop": "流行",
    "genre:rock": "摇滚",
    "genre:folk": "民谣",
    "genre:electronic": "电子",
    "genre:rap": "说唱",
    "genre:rnb": "R&B",
    "genre:acg": "ACG",
    "genre:ost": "影视原声",
    "genre:live": "Live",
    "genre:remix": "Remix",
    "taste:familiar": "熟悉",
    "taste:explore": "探索",
    "taste:mainstream": "主流",
    "taste:deep_cut": "小众",
    "playback:playable": "可播放",
    "playback:copyright_limited": "版权受限",
    "source:liked": "红心",
    "source:playlist": "歌单",
    "source:recent": "最近播放",
    "source:discovery": "探索来源",
    liked: "红心",
    playlist: "歌单",
    recent: "最近播放",
    exploration: "探索",
    playable: "可播放",
    copyright_limited: "版权受限",
    calm: "安静",
    focused: "专注",
    balanced: "均衡",
    open: "开放",
    familiar: "熟悉",
    high_energy: "高能",
    instrumental: "纯音乐",
    night: "夜晚",
    love_song: "情歌",
    nostalgic: "怀旧",
    introspective: "自省",
    bright: "明亮",
    melancholy: "低落",
    rock: "摇滚",
    electronic: "电子",
    folk: "民谣",
    rap: "说唱",
    pop: "流行",
    rnb: "R&B",
    live: "Live",
    remix: "Remix",
    cover: "翻唱",
    ost: "影视原声",
    acg: "ACG",
    chinese: "华语",
    western: "欧美",
    japanese: "日语",
    korean: "韩语",
    popular: "热门",
    mainstream: "主流热度",
    deep_cut: "小众",
    core_collection: "核心收藏",
    rediscovered: "可重温",
    fresh_in_library: "近期入库",
    recent_release: "近年发行",
    classic_release: "经典发行",
    unknown_era: "发行年代未知",
    short_song: "短歌",
    standard_song: "常规时长",
    long_song: "长歌",
    epic_length: "超长曲目",
    collaboration: "多人合作",
    solo_artist: "单人演唱",
    mv_available: "有 MV"
  };

  const directLabel = labels[normalizedTag];
  if (directLabel) return isAiTag ? `AI ${directLabel}` : directLabel;

  const dynamicLabel = dynamicTagLabel(normalizedTag);
  const label = dynamicLabel ?? normalizedTag;
  return isAiTag ? `AI ${label}` : label;
}

export function visibleSongTags(tags: string[], limit = 6) {
  return selectVisibleTags(orderTags(tags), limit).map((tag) => ({ tag, label: tagLabel(tag) }));
}

export function reasonTags(tags: string[], limit = 2) {
  const ordered = orderTags(tags).filter((tag) => !sourceTags.has(tag) && !stateTags.has(tag));
  return ordered.length ? ordered.slice(0, limit) : orderTags(tags).slice(0, limit);
}

export function extractNeteaseWikiTags(value: unknown): string[] {
  const tags = new Set<string>();
  const blocks = asRecord(readPath(value, ["data"]))?.blocks;
  for (const block of asArray(blocks)) {
    const blockRecord = asRecord(block);
    if (!blockRecord) continue;
    const blockTitle = readUiTitle(blockRecord);
    if (blockRecord?.code !== "SONG_PLAY_ABOUT_SONG_BASIC" && blockTitle !== "音乐百科") continue;

    for (const creative of asArray(blockRecord.creatives)) {
      const creativeRecord = asRecord(creative);
      const title = readUiTitle(creativeRecord);
      const resourceTitles = asArray(creativeRecord?.resources)
        .map((resource) => readUiTitle(asRecord(resource)))
        .map(cleanTagText)
        .filter(Boolean);

      if (title.includes("曲风")) {
        for (const resourceTitle of resourceTitles) addWikiStyleTags(tags, resourceTitle);
      } else if (title.includes("推荐标签")) {
        for (const resourceTitle of resourceTitles) addWikiMoodTags(tags, resourceTitle);
      } else if (title.includes("语种")) {
        for (const resourceTitle of resourceTitles) addLanguageFromLabel(tags, resourceTitle);
      }
    }
  }

  return Array.from(tags);
}

export function ensureDistinctVisibleSongTags<T extends VisibleTagSong>(songs: T[], limit = 6): T[] {
  const enhanced = songs.map((song) => ({ ...song, tags: Array.from(new Set(song.tags)) }));
  for (const [index, song] of enhanced.entries()) {
    const addition = bestBatchMetadataTag(song, enhanced, index);
    if (addition && !song.tags.includes(addition)) song.tags = [...song.tags, addition];
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const groups = new Map<string, number[]>();
    enhanced.forEach((song, index) => {
      const signature = visibleSignature(song.tags, limit);
      groups.set(signature, [...(groups.get(signature) ?? []), index]);
    });

    const duplicateGroups = Array.from(groups.values()).filter((indexes) => indexes.length > 1);
    if (duplicateGroups.length === 0) return enhanced;

    for (const indexes of duplicateGroups) {
      for (const index of indexes) {
        const song = enhanced[index];
        const fallbackTags = observableFallbackTags(song);
        const addition = fallbackTags.find((tag) => !song.tags.includes(tag));
        if (addition) song.tags = [...song.tags, addition];
      }
    }
  }

  return enhanced;
}

function orderTags(tags: string[]) {
  const unique = Array.from(new Set(tags));
  const priority = [
    ...reasonTagPriority,
    "core_collection",
    "fresh_in_library",
    "rediscovered",
    "liked",
    "playlist",
    "recent",
    "playable",
    "copyright_limited",
    "mainstream",
    "popular",
    "deep_cut",
    "recent_release",
    "classic_release",
    "unknown_era",
    "standard_song",
    "short_song",
    "long_song",
    "epic_length",
    "collaboration",
    "solo_artist",
    "mv_available",
    "familiar",
    "open"
  ];
  return unique.sort((left, right) => {
    const leftIndex = dynamicTagPriority(left) ?? priority.indexOf(left);
    const rightIndex = dynamicTagPriority(right) ?? priority.indexOf(right);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });
}

function selectVisibleTags(orderedTags: string[], limit: number) {
  if (limit <= 0) return [];
  const visible = orderedTags.slice(0, limit);
  if (visible.some(isObservableMetadataTag)) return visible;

  const metadataTag = orderedTags.find(isObservableMetadataTag);
  if (!metadataTag) return visible;
  if (visible.length < limit) return [...visible, metadataTag];
  if (visible.length === 0) return [metadataTag];

  const replacementIndex = findReplaceableVisibleTagIndex(visible);
  return visible.map((tag, index) => (index === replacementIndex ? metadataTag : tag));
}

function findReplaceableVisibleTagIndex(tags: string[]) {
  const lowSignalIndex = findLastIndex(tags, (tag) => sourceTags.has(tag) || stateTags.has(tag));
  if (lowSignalIndex !== -1) return lowSignalIndex;
  return tags.length - 1;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function isObservableMetadataTag(tag: string) {
  return tag.startsWith("artist:") || tag.startsWith("album:") || tag.startsWith("song:");
}

function addKeywordTags(tags: Set<string>, text: string) {
  if (hasAny(text, ["instrumental", "纯音乐", "伴奏", "钢琴", "piano", "lofi", "lo-fi", "轻音乐", "ambient"])) {
    tags.add("instrumental");
  }
  if (hasAny(text, ["夜", "安静", "睡", "眠", "治愈", "雨", "月", "piano", "lofi", "lo-fi", "ambient", "acoustic"])) {
    tags.add("calm");
  }
  if (hasAny(text, ["night", "黑夜", "夜", "晚安", "月", "星", "凌晨"])) {
    tags.add("night");
  }
  if (hasAny(text, ["爱", "喜欢", "恋", "情歌", "心动", "告白", "lover", "love"])) {
    tags.add("love_song");
  }
  if (hasAny(text, ["过去", "从前", "后来", "旧", "回忆", "再见", "青春", "小时候"])) {
    tags.add("nostalgic");
  }
  if (hasAny(text, ["自己", "孤独", "一个人", "答案", "理想", "人生", "醒来", "自我"])) {
    tags.add("introspective");
  }
  if (hasAny(text, ["快乐", "晴天", "阳光", "夏天", "旅行", "奔跑", "自由", "happy"])) {
    tags.add("bright");
  }
  if (hasAny(text, ["苦", "痛", "伤", "泪", "遗憾", "寂寞", "难过", "sad", "blue"])) {
    tags.add("melancholy");
  }
  if (hasAny(text, ["rock", "摇滚", "五月天", "痛仰", "新裤子", "逃跑计划", "告五人"])) {
    tags.add("rock");
  }
  if (hasAny(text, ["electronic", "edm", "电音", "电子", "dj", "house", "techno", "synth"])) {
    tags.add("electronic");
  }
  if (hasAny(text, ["folk", "民谣", "赵雷", "陈粒", "马頔", "尧十三"])) {
    tags.add("folk");
  }
  if (hasAny(text, ["rap", "hip hop", "hip-hop", "说唱", "嘻哈"])) {
    tags.add("rap");
  }
  if (hasAny(text, ["r&b", "rhythm and blues", "节奏布鲁斯"])) {
    tags.add("rnb");
  }
  if (hasAny(text, ["pop", "流行"])) {
    tags.add("pop");
  }
  if (hasAny(text, ["live", "现场", "演唱会"])) {
    tags.add("live");
  }
  if (hasAny(text, ["remix", "混音", "重新混音"])) {
    tags.add("remix");
  }
  if (hasAny(text, ["cover", "翻唱"])) {
    tags.add("cover");
  }
  if (hasAny(text, ["ost", "原声", "影视", "电影", "电视剧", "插曲", "主题曲", "soundtrack"])) {
    tags.add("ost");
  }
  if (hasAny(text, ["anime", "动画", "动漫", "游戏", "op", "ed", "acg", "原神", "崩坏"])) {
    tags.add("acg");
  }
}

function addReleaseEraTag(tags: Set<string>, publishTime?: number | null) {
  if (publishTime === null || publishTime === undefined || publishTime <= 0) {
    tags.add("unknown_era");
    return;
  }
  const year = new Date(publishTime).getUTCFullYear();
  if (!Number.isFinite(year) || year <= 1970) {
    tags.add("unknown_era");
  } else if (year >= 2020) {
    tags.add("recent_release");
  } else if (year <= 2010) {
    tags.add("classic_release");
  }
}

function addLanguageTag(tags: Set<string>, text: string) {
  if (/[\u3040-\u30ff]/.test(text)) {
    tags.add("japanese");
    return;
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    tags.add("korean");
    return;
  }
  if (/[\u3400-\u9fff]/.test(text)) {
    tags.add("chinese");
    return;
  }
  if (/[a-z]/.test(text)) tags.add("western");
}

function normalizeText(text: string) {
  return text.toLowerCase();
}

function hasAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function addWikiStyleTags(tags: Set<string>, label: string) {
  addLanguageFromLabel(tags, label);
  addKeywordTags(tags, normalizeText(label));
  const segments = splitWikiLabel(label);
  const usefulSegments = segments.length > 1 ? [segments[segments.length - 1]] : segments;
  for (const segment of usefulSegments) {
    if (genericStyleSegments.has(segment)) continue;
    tags.add(`style:${segment}`);
  }
}

function addWikiMoodTags(tags: Set<string>, label: string) {
  const mood = cleanTagText(label);
  if (!mood || mood.length > 12) return;
  tags.add(`mood:${mood}`);

  if (hasAny(mood, ["悲", "伤", "苦", "emo", "遗憾", "低落"])) tags.add("melancholy");
  if (hasAny(mood, ["浪漫", "心动", "爱情", "恋爱"])) tags.add("love_song");
  if (hasAny(mood, ["孤独", "一个人", "独处"])) tags.add("introspective");
  if (hasAny(mood, ["快乐", "开心", "阳光"])) tags.add("bright");
  if (hasAny(mood, ["治愈", "安静", "放松"])) tags.add("calm");
}

function addLanguageFromLabel(tags: Set<string>, label: string) {
  if (hasAny(label, ["华语", "国语", "中文", "粤语", "闽南语"])) tags.add("chinese");
  if (hasAny(label, ["欧美", "英文", "英语", "western"])) tags.add("western");
  if (hasAny(label, ["日语", "日本", "j-pop"])) tags.add("japanese");
  if (hasAny(label, ["韩语", "韩国", "kpop", "k-pop"])) tags.add("korean");
}

function splitWikiLabel(label: string) {
  return label
    .split(/[-－–—/、｜|]/)
    .map(cleanTagText)
    .filter(Boolean);
}

function visibleSignature(tags: string[], limit: number) {
  return visibleSongTags(tags, limit)
    .map(({ tag }) => tag)
    .join("|");
}

function observableFallbackTags(song: VisibleTagSong) {
  return [
    prefixedTag("artist", song.artistNames?.[0]),
    prefixedTag("album", song.albumName),
    prefixedTag("song", song.name),
    durationFallbackTag(song.durationMs),
    popularityFallbackTag(song.popularity)
  ].filter(Boolean) as string[];
}

function bestBatchMetadataTag(song: VisibleTagSong, songs: VisibleTagSong[], index: number) {
  const candidateGroups = songs.map(observableFallbackTags);
  const maxCandidates = Math.max(...candidateGroups.map((tags) => tags.length), 0);
  for (let candidateIndex = 0; candidateIndex < maxCandidates; candidateIndex += 1) {
    const values = candidateGroups.map((tags) => tags[candidateIndex] ?? "");
    const value = values[index];
    if (!value) continue;
    if (values.filter((candidate) => candidate === value).length === 1) return value;
  }
  return candidateGroups[index]?.[0] ?? null;
}

function prefixedTag(prefix: "artist" | "album" | "song", value?: string | null) {
  const cleaned = cleanTagText(value ?? "");
  if (!cleaned) return null;
  return `${prefix}:${truncateTagValue(cleaned)}`;
}

function durationFallbackTag(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return null;
  if (durationMs <= 150000) return "short_song";
  if (durationMs >= 300000) return "long_song";
  return "standard_song";
}

function popularityFallbackTag(popularity?: number | null) {
  if (popularity === null || popularity === undefined) return null;
  if (popularity >= 90) return "popular";
  if (popularity <= 45) return "deep_cut";
  return "mainstream";
}

function dynamicTagLabel(tag: string) {
  const separatorIndex = tag.indexOf(":");
  if (separatorIndex === -1) return null;
  const prefix = tag.slice(0, separatorIndex);
  const value = tag.slice(separatorIndex + 1);
  const labels: Record<string, string> = {
    artist: "歌手",
    album: "专辑",
    song: "歌曲",
    style: "",
    mood: "",
    version: "版本"
  };
  if (!(prefix in labels)) return value;
  return labels[prefix] ? `${labels[prefix]}：${value}` : value;
}

function dynamicTagPriority(tag: string) {
  if (tag.startsWith("style:")) return -100;
  if (tag.startsWith("artist:")) return -99;
  if (tag.startsWith("album:")) return -98;
  if (tag.startsWith("song:")) return -97;
  if (tag.startsWith("mood:")) return -90;
  if (tag.startsWith("version:")) return -80;
  return null;
}

function cleanTagText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateTagValue(value: string) {
  return value.length > 18 ? value.slice(0, 18) : value;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function readUiTitle(record: Record<string, unknown> | null) {
  const mainTitle = asRecord(asRecord(record?.uiElement)?.mainTitle)?.title;
  return typeof mainTitle === "string" ? mainTitle : "";
}
