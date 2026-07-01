import { getStoredLibraryStatus, resolveCurrentUserForRequest } from "@/lib/appServices";

export async function GET(request: Request) {
  try {
    const user = await resolveCurrentUserForRequest(request);
    return Response.json(await getStoredLibraryStatus(user.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取本地曲库失败。" }, { status: 500 });
  }
}
