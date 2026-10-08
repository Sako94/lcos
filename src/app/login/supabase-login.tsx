"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export function SupabaseLogin({ url, anonKey }: { url: string; anonKey: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createBrowserClient(url, anonKey);
    const { error } = await supabase.auth.signInWithPassword({ email: String(form.get("email")), password: String(form.get("password")) });
    setPending(false);
    if (error) return setError(error.message);
    router.push("/");
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <input name="email" type="email" placeholder="Email" required className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
      <input name="password" type="password" placeholder="Password" required className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
      <button disabled={pending} className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Sign in</button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
