import type { ReactNode } from "react";
import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-neutral-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2> : null}
      {children}
    </section>
  );
}

const tone: Record<string, string> = {
  proposed: "bg-amber-50 text-amber-800 ring-amber-200",
  verified: "bg-sky-50 text-sky-800 ring-sky-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
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
  live: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  connected: "bg-emerald-50 text-emerald-800 ring-emerald-200",
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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
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

export const btn = "inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition";
export const btnPrimary = `${btn} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700`;
export const btnSecondary = `${btn} border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`;
export const btnDanger = `${btn} border-red-300 bg-white text-red-700 hover:bg-red-50`;
export const input = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">{children}</p>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  );
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const x = typeof d === "string" ? (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d)) : d;
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
