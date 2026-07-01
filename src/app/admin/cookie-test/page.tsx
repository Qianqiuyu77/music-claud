import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CookieTestPanel } from "@/components/admin/CookieTestPanel";
import { canAccessAdmin } from "@/lib/admin/access";

export default async function CookieTestPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (!(await canAccessAdmin(new Request("http://localhost/admin/cookie-test", { headers: { cookie: cookieHeader } })))) {
    notFound();
  }
  return <CookieTestPanel />;
}
