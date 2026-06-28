import type { LyricLine } from "@/lib/lyrics/lyrics";
import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";

type LyricsServices = {
  getLyrics: (songId: string) => Promise<LyricLine[]>;
};

const defaultProvider = new NeteaseCloudProvider();
let injectedServices: Partial<LyricsServices> = {};

export async function getSongLyrics(songId: string) {
  const getLyrics = injectedServices.getLyrics ?? ((id: string) => defaultProvider.getLyrics(id));
  return getLyrics(songId);
}

export function setLyricsServicesForTests(services: Partial<LyricsServices>) {
  injectedServices = services;
}

export function resetLyricsServicesForTests() {
  injectedServices = {};
}
