import { assertUserCanAccessSong, getNeteaseCookieForUser, resolveCurrentUserForRequest, UserSongAccessError } from "@/lib/appServices";
import { proxyPlaybackRequest } from "@/lib/playback/playbackService";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "缺少歌曲 ID。" }, { status: 400 });
  }

  try {
    const user = await resolveCurrentUserForRequest(request);
    await assertUserCanAccessSong(user.id, id);
    return await proxyPlaybackRequest(id, request.headers, await getNeteaseCookieForUser(user.id));
  } catch (error) {
    if (error instanceof UserSongAccessError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: "播放服务暂时不可用，请稍后再试。" }, { status: 502 });
  }
}
