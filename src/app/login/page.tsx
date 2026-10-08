import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withService } from "@/lib/db";
import { devCookieName, getCurrentUser } from "@/lib/auth";

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
    <main className="mx-auto mt-24 max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold">Wavy LCOS</h1>
      <p className="mt-1 text-sm text-neutral-500">Lifecycle Client Operating System</p>
      {mode === "dev" ? (
        <form action={devLogin} className="mt-6 space-y-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Local sign-in (dev mode)</p>
          {users.map((u) => (
            <button
              key={u.id}
              name="user_id"
              value={u.id}
              className="flex w-full items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 text-left hover:bg-neutral-50"
            >
              <span>
                <span className="font-medium">{u.fullName}</span>
                <span className="block text-xs text-neutral-500">{u.email}</span>
              </span>
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{u.role.replace("_", " ")}</span>
            </button>
          ))}
        </form>
      ) : (
        <p className="mt-6 text-sm text-neutral-600">
          Sign in through Supabase Auth. Configure NEXT_PUBLIC_SUPABASE_URL and the anon key, then use the
          hosted sign-in page or magic link; this app reads the session cookie.
        </p>
      )}
    </main>
  );
}
