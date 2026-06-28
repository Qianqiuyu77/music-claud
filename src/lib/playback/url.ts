export function playbackProxyUrl(songId: string) {
  return `/api/playback?id=${encodeURIComponent(songId)}`;
}
