import type { CandidateSong } from "@/lib/recommendation/types";
import type { LyricLine } from "@/lib/lyrics/lyrics";

export type NeteaseImportResult = {
  songs: CandidateSong[];
  partialFailures: string[];
};

export type NeteaseProvider = {
  getLoginQr(): Promise<{ key: string; qrUrl: string }>;
  getLoginStatus(key: string): Promise<{
    status: "waiting" | "scanned" | "authorized" | "expired";
    encryptedCookie?: string;
    rawCookie?: string;
    source?: "cookie" | "qr";
  }>;
  importLibrary(cookieOverride?: string, options?: { quick?: boolean; limit?: number }): Promise<NeteaseImportResult>;
  expandLibrary?(options: { seedSongIds?: string[]; limit?: number }, cookieOverride?: string | null): Promise<NeteaseImportResult>;
  getLyrics?(songId: string): Promise<LyricLine[]>;
};
