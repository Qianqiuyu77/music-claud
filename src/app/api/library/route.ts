import { getStoredLibraryStatus } from "@/lib/appServices";

export async function GET() {
  try {
    return Response.json(await getStoredLibraryStatus());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取本地曲库失败。" }, { status: 500 });
  }
}
