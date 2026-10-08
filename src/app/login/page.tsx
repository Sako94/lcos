import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withService } from "@/lib/db";
import { devCookieName, getCurrentUser } from "@/lib/auth";
import { SupabaseLogin } from "./supabase-login";

export const dynamic = "force-dynamic";

async function devLogin(formData: FormData) {
  "use server";
  const id = String(formData.get("user_id") ?? "");
  if (!id) return;
  const store = await cookies();
  store.set(devCookieName, id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const mode = process.env.AUTH_MODE ?? "dev";
  const users =
    mode === "dev"
      ? await withService(
          (tx) =>
            tx<{ id: string; fullName: string; email: string; role: string }[]>`
              select id, full_name, email, role from public.profiles where email like '%@wavystudios.com' order by role, full_name`,
        )
      : [];
  return (
    <main className="page-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg-2 p-8">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">WAVY<span className="text-lime">·</span>LCOS</h1>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-muted">Lifecycle Client Operating System</p>
      {mode === "dev" ? (
        <form action={devLogin} className="mt-6 space-y-3">
          <p className="label">Local sign-in (dev mode)</p>
          {users.map((u) => (
            <button
              key={u.id}
              name="user_id"
              value={u.id}
              className="flex w-full items-center justify-between rounded-lg border border-line bg-bg-3 px-4 py-3 text-left transition hover:border-lime"
            >
              <span>
                <span className="font-medium">{u.fullName}</span>
                <span className="block text-xs text-neutral-500">{u.email}</span>
              </span>
              <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-muted">{u.role.replace("_", " ")}</span>
            </button>
          ))}
        </form>
      ) : (
        <SupabaseLogin url={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""} />
      )}
      </div>
    </main>
  );
}
