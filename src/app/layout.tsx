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
  store.delete(devCookieName);
  redirect("/login");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const clients = user
    ? await withUser(user.id, (tx) => tx<{ id: string; name: string; slug: string }[]>`select id, name, slug from public.clients where active order by name`)
    : [];
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-neutral-50 text-neutral-900">
        {user ? (
          <div className="flex min-h-screen">
            <aside className="w-60 shrink-0 border-r border-neutral-200 bg-white px-4 py-5">
              <Link href="/" className="block text-lg font-semibold">
                Wavy LCOS
              </Link>
              <nav className="mt-6 space-y-6 text-sm">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Agency</p>
                  <NavLink href="/">Home</NavLink>
                  <NavLink href="/playbook">Playbook</NavLink>
                  <NavLink href="/agent">Agent activity</NavLink>
                </div>
                {clients.map((c) => (
                  <div key={c.id}>
                    <p className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{c.name}</p>
                    <NavLink href={`/clients/${c.slug}`}>Overview</NavLink>
                    <NavLink href={`/clients/${c.slug}/facts`}>Source of Truth</NavLink>
                    <NavLink href={`/clients/${c.slug}/audit`}>Audit</NavLink>
                    <NavLink href={`/clients/${c.slug}/flows`}>Flows</NavLink>
                    <NavLink href={`/clients/${c.slug}/calendar`}>Calendar & briefs</NavLink>
                    <NavLink href={`/clients/${c.slug}/meetings`}>Meetings</NavLink>
                  </div>
                ))}
              </nav>
              <div className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
                <p className="font-medium text-neutral-800">{user.fullName}</p>
                <p>{user.role.replace("_", " ")}{user.canPublish ? " · publisher" : ""}</p>
                <form action={signOut}>
                  <button className="mt-2 underline">Sign out</button>
                </form>
              </div>
            </aside>
            <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
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
    <Link href={href} className="block rounded px-2 py-1 text-neutral-700 hover:bg-neutral-100">
      {children}
    </Link>
  );
}
