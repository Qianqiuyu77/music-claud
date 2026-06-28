import { getLoginQrPreview } from "@/lib/appServices";

export async function GET() {
  return Response.json(await getLoginQrPreview());
}
