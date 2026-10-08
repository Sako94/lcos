import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { devCookieName, getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";

export const metadata: Metadata = {
  title: "Wavy LCOS",
  description: "Lifecycle Client Operating System — Wavy Studios",
};

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";
  const store = await cookies();
  if ((process.env.AUTH_MODE ?? "dev") === "supabase") {
    const { createServerClient } = await import("@supabase/ssr");
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => store.getAll(), setAll: (all) => all.forEach(({ name, value, options }) => store.set(name, value, options)) },
    });
    await supabase.auth.signOut();
  } else {
    store.delete(devCookieName);
  }
  redirect("/login");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clients = user
    ? await withUser(user.id, (tx) => tx<{ id: string; name: string; slug: string }[]>`select id, name, slug from public.clients where active order by name`)
    : [];
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="page-bg min-h-full bg-bg text-fg">
        {user ? (
          <div className="flex min-h-screen">
            <aside className="w-60 shrink-0 border-r border-line-soft bg-bg-2 px-4 py-5">
              <Link href="/" className="block font-display text-lg font-extrabold tracking-tight text-fg hover:text-lime">
                WAVY<span className="text-lime">·</span>LCOS
              </Link>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-muted">Lifecycle Client OS</p>
              <nav className="mt-6 space-y-6 text-sm">
                <div>
                  <p className="label mb-1">Agency</p>
                  <NavLink href="/">Home</NavLink>
                  <NavLink href="/playbook">Playbook</NavLink>
                  <NavLink href="/agent">Agent activity</NavLink>
                </div>
                {clients.map((c) => (
                  <div key={c.id}>
                    <p className="label mb-1">{c.name}</p>
                    <NavLink href={`/clients/${c.slug}`}>Overview</NavLink>
                    <NavLink href={`/clients/${c.slug}/facts`}>Source of Truth</NavLink>
                    <NavLink href={`/clients/${c.slug}/audit`}>Audit</NavLink>
                    <NavLink href={`/clients/${c.slug}/flows`}>Flows</NavLink>
                    <NavLink href={`/clients/${c.slug}/calendar`}>Calendar & briefs</NavLink>
                    <NavLink href={`/clients/${c.slug}/meetings`}>Meetings</NavLink>
                  </div>
                ))}
              </nav>
              <div className="mt-10 border-t border-line-soft pt-4 text-xs text-fg-muted">
                <p className="font-semibold text-fg">{user.fullName}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.1em]">{user.role.replace("_", " ")}{user.canPublish ? " · publisher" : ""}</p>
                <form action={signOut}>
                  <button className="mt-2 underline">Sign out</button>
                </form>
              </div>
            </aside>
            <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-md px-2 py-1 text-fg-2 transition hover:bg-bg-3 hover:text-lime">
      {children}
    </Link>
  );
}
