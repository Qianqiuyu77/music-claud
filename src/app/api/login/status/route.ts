import { getLoginStatusPreview } from "@/lib/appServices";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return Response.json({ error: "missing key" }, { status: 400 });
  }
  return Response.json(await getLoginStatusPreview(key));
}
