import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withService } from "./db";

export type Role = "admin" | "account_lead" | "contributor";
export type CurrentUser = { id: string; email: string; fullName: string; role: Role; canPublish: boolean };

const DEV_COOKIE = "lcos_dev_user";

/**
 * AUTH_MODE=dev: a cookie holds the id of a seeded profile (local only).
 * AUTH_MODE=supabase: the Supabase session cookie is read with @supabase/ssr and the user id comes from it.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const mode = process.env.AUTH_MODE ?? "dev";
  let userId: string | null = null;
  if (mode === "supabase") {
    const { createServerClient } = await import("@supabase/ssr");
    const store = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } },
    );
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } else {
    const store = await cookies();
    userId = store.get(DEV_COOKIE)?.value ?? null;
  }
  if (!userId) return null;
  const rows = await withService(
    (tx) => tx<CurrentUser[]>`select id, email, full_name, role, can_publish from public.profiles where id = ${userId}`,
  );
  return rows[0] ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export const devCookieName = DEV_COOKIE;
