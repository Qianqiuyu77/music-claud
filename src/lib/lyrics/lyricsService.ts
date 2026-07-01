import type { LyricLine } from "@/lib/lyrics/lyrics";
import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";

type LyricsServices = {
  getLyrics: (songId: string, cookie?: string | null) => Promise<LyricLine[]>;
};

const defaultProvider = new NeteaseCloudProvider();
let injectedServices: Partial<LyricsServices> = {};

export async function getSongLyrics(songId: string, cookie?: string | null) {
  const getLyrics = injectedServices.getLyrics ?? ((id: string, cookieOverride?: string | null) => defaultProvider.getLyrics(id, cookieOverride));
  return getLyrics(songId, cookie);
}

export function setLyricsServicesForTests(services: Partial<LyricsServices>) {
  injectedServices = services;
}

export function resetLyricsServicesForTests() {
  injectedServices = {};
}
