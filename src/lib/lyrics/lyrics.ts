export type LyricLine = {
  time: number;
  text: string;
  translation?: string;
};

type ParseInput = {
  lyric?: string | null;
  translatedLyric?: string | null;
};

const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseSyncedLyrics({ lyric, translatedLyric }: ParseInput): LyricLine[] {
  const primaryLines = parseLrcText(lyric);
  const translatedLines = parseLrcText(translatedLyric);
  if (!primaryLines.length) {
    return translatedLines.map((line) => ({ time: line.time, text: line.text }));
  }

  const translationByTime = new Map(translatedLines.map((line) => [timeKey(line.time), line.text]));
  return primaryLines.map((line) => {
    const translation = translationByTime.get(timeKey(line.time)) ?? findNearbyTranslation(line.time, translatedLines);
    return translation ? { ...line, translation } : line;
  });
}

export function findActiveLyricLineIndex(lines: LyricLine[], currentTime: number) {
  if (!lines.length || currentTime < lines[0].time) return -1;
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const next = lines[middle + 1];
    if (lines[middle].time <= currentTime && (!next || currentTime < next.time)) {
      return middle;
    }
    if (lines[middle].time > currentTime) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return -1;
}

function parseLrcText(value?: string | null): LyricLine[] {
  if (!value?.trim()) return [];
  const lines: LyricLine[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    timestampPattern.lastIndex = 0;
    const matches = Array.from(rawLine.matchAll(timestampPattern));
    if (!matches.length) continue;
    const text = rawLine.replace(timestampPattern, "").trim();
    if (!text || isMetadataLine(text)) continue;
    for (const match of matches) {
      const time = parseTimestamp(match);
      if (time === null) continue;
      lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function parseTimestamp(match: RegExpMatchArray) {
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0").slice(0, 3)}`) : 0;
  return Number((minutes * 60 + seconds + fraction).toFixed(3));
}

function findNearbyTranslation(time: number, lines: LyricLine[]) {
  return lines.find((line) => Math.abs(line.time - time) <= 0.08)?.text;
}

function timeKey(time: number) {
  return time.toFixed(2);
}

function isMetadataLine(text: string) {
  return /^[a-z]+:/i.test(text) || /^作词|^作曲|^编曲|^制作人/.test(text);
}
