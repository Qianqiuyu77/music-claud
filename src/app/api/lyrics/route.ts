import { assertUserCanAccessSong, getNeteaseCookieForUser, resolveCurrentUserForRequest, UserSongAccessError } from "@/lib/appServices";
import { getSongLyrics } from "@/lib/lyrics/lyricsService";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "缺少歌曲 ID。" }, { status: 400 });
  }

  try {
    const user = await resolveCurrentUserForRequest(request);
    await assertUserCanAccessSong(user.id, id);
    return Response.json({
      songId: id,
      lines: await getSongLyrics(id, await getNeteaseCookieForUser(user.id))
    });
  } catch (error) {
    if (error instanceof UserSongAccessError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "歌词获取失败，请稍后再试。" }, { status: 502 });
  }
}
