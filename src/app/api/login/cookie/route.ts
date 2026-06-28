import { saveNeteaseCookie } from "@/lib/appServices";

export async function POST(request: Request) {
  const body = (await request.json()) as { cookie?: string };
  const result = await saveNeteaseCookie(body.cookie ?? "");
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
