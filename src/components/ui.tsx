import type { ReactNode } from "react";
import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-line-soft pb-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{title}</h1>
        {subtitle ? <div className="mt-2 text-sm text-fg-2">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-bg-2 p-5 ${className}`}>
      {title ? <h2 className="card-title mb-4 flex flex-wrap items-center gap-2">{title}</h2> : null}
      {children}
    </section>
  );
}

const tone: Record<string, string> = {
  proposed: "bg-amber-50 text-amber-800 ring-amber-200",
  verified: "bg-sky-50 text-sky-800 ring-sky-200",
  approved: "bg-lime/10 text-lime ring-lime/40",
  stale: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  new: "bg-amber-50 text-amber-800 ring-amber-200",
  confirmed: "bg-sky-50 text-sky-800 ring-sky-200",
  promoted: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  dismissed: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  draft: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  copy_review: "bg-amber-50 text-amber-800 ring-amber-200",
  qa: "bg-amber-50 text-amber-800 ring-amber-200",
  internal_review: "bg-amber-50 text-amber-800 ring-amber-200",
  internal_approved: "bg-sky-50 text-sky-800 ring-sky-200",
  client_approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  client_approval: "bg-sky-50 text-sky-800 ring-sky-200",
  active: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  live: "bg-lime/10 text-lime ring-lime/40",
  connected: "bg-lime/10 text-lime ring-lime/40",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  not_connected: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  error: "bg-red-50 text-red-800 ring-red-200",
  failed: "bg-red-50 text-red-800 ring-red-200",
  succeeded: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  running: "bg-sky-50 text-sky-800 ring-sky-200",
  queued: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  needs_approval: "bg-amber-50 text-amber-800 ring-amber-200",
  agent: "bg-violet-50 text-violet-800 ring-violet-200",
  user: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  open: "bg-amber-50 text-amber-800 ring-amber-200",
  done: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  todo: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  in_progress: "bg-sky-50 text-sky-800 ring-sky-200",
};

export function Chip({ value, label }: { value: string; label?: string }) {
  const cls = tone[value] ?? "bg-neutral-100 text-neutral-700 ring-neutral-200";
  return (
    <span className={`mono inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset ${cls}`}>
      {label ?? value.replaceAll("_", " ")}
    </span>
  );
}

export function AgentTag({ runId }: { runId?: string | null }) {
  return runId ? (
    <Link href={`/agent/runs/${runId}`} className="inline-flex items-center gap-1 text-xs text-violet-700 hover:underline">
      <Chip value="agent" label="agent" /> view run
    </Link>
  ) : (
    <Chip value="agent" label="agent" />
  );
}

export const btn = "inline-flex items-center rounded-full border px-3.5 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.08em] transition";
export const btnPrimary = `${btn} border-lime bg-lime text-bg hover:bg-lime-dim hover:border-lime-dim hover:text-bg`;
export const btnSecondary = `${btn} border-line bg-bg-3 text-fg hover:border-fg-muted`;
export const btnDanger = `${btn} border-coral/40 bg-transparent text-coral hover:bg-coral/10`;
export const input = "w-full rounded-lg border border-line bg-bg-3 px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-lime focus:outline-none focus:ring-1 focus:ring-lime";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-sm text-fg-muted">{children}</p>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">{children}</tbody>
      </table>
    </div>
  );
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const x = typeof d === "string" ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d)) : d;
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
}
