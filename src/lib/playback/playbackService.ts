import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";
export { playbackProxyUrl } from "./url";

type PlaybackServices = {
  resolveFreshPlaybackUrl: (songId: string) => Promise<string | null>;
  fetchMedia: typeof fetch;
};

const defaultProvider = new NeteaseCloudProvider();
let injectedServices: Partial<PlaybackServices> = {};

export async function resolveFreshPlaybackUrl(songId: string) {
  const resolver = injectedServices.resolveFreshPlaybackUrl ?? ((id: string) => defaultProvider.getFreshPlaybackUrl(id));
  return resolver(songId);
}

export async function proxyPlaybackRequest(songId: string, requestHeaders: Headers) {
  const freshUrl = await resolveFreshPlaybackUrl(songId);
  if (!freshUrl) {
    return Response.json({ error: "这首歌暂时没有可播放地址，可能受版权限制。" }, { status: 404 });
  }

  const upstream = await getFetchMedia()(freshUrl, {
    headers: buildPlaybackHeaders(requestHeaders),
    redirect: "follow"
  });

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: "播放地址已失效，正在尝试重新推荐。" }, { status: upstream.status === 403 ? 502 : upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: copyAudioHeaders(upstream.headers)
  });
}

export function setPlaybackServicesForTests(services: Partial<PlaybackServices>) {
  injectedServices = services;
}

export function resetPlaybackServicesForTests() {
  injectedServices = {};
}

function getFetchMedia() {
  return injectedServices.fetchMedia ?? fetch;
}

function buildPlaybackHeaders(requestHeaders: Headers) {
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0",
    referer: "https://music.163.com/",
    origin: "https://music.163.com"
  };
  const range = requestHeaders.get("range");
  if (range) headers.range = range;
  return headers;
}

function copyAudioHeaders(headers: Headers) {
  const copied = new Headers();
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
    const value = headers.get(key);
    if (value) copied.set(key, value);
  }
  copied.set("x-content-type-options", "nosniff");
  return copied;
}
