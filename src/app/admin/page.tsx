import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdminMusicApp } from "@/components/admin/AdminMusicApp";
import { canAccessAdmin } from "@/lib/admin/access";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (!(await canAccessAdmin(new Request("http://localhost/admin", { headers: { cookie: cookieHeader } })))) {
    notFound();
  }
  return <AdminMusicApp />;
}
