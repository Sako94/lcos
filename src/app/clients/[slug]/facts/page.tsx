import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { FACT_CATEGORIES, clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, input, fmtDate, AgentTag } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { addSource, editFact, proposeFact, setFactStatus } from "./actions";

type Fact = {
  id: string; category: string; statement: string; status: "proposed" | "verified" | "approved" | "stale";
  sourceQuote: string | null; sourceTitle: string | null; sourceUrl: string | null; proposedByKind: string;
  verifiedBy: string | null; approvedBy: string | null; approvedAt: string | null; reviewDue: string | null; version: number;
};

export default async function FactsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { slug } = await params;
  const { status: filter } = await searchParams;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const facts = await tx<Fact[]>`
      select f.id, f.category, f.statement, f.status, f.source_quote, s.title as source_title, s.url as source_url, f.proposed_by_kind,
             pv.full_name as verified_by, pa.full_name as approved_by, f.approved_at, f.review_due, f.version
      from public.facts f left join public.sources s on s.id = f.source_id
      left join public.profiles pv on pv.id = f.verified_by left join public.profiles pa on pa.id = f.approved_by
      where f.client_id = ${client.id} ${filter ? tx`and f.status = ${filter}::app.fact_status` : tx``}
      order by f.category, f.status, f.created_at`;
    const sources = await tx<{ id: string; title: string; kind: string; url: string | null; capturedAt: string | null }[]>`
      select id, title, kind, url, captured_at from public.sources where client_id = ${client.id} order by captured_at desc nulls last`;
    return { role, facts, sources };
  });
  const canReview = d.role === "admin" || d.role === "account_lead";
  const isAdmin = d.role === "admin";

  return (
    <>
      <PageHeader
        title={`${client.name} · Source of Truth`}
        subtitle="Every fact carries a status, a source, and an approver. Drafts and agent output can only cite Approved facts."
        actions={
          <div className="flex gap-1 text-xs">
            {["", "proposed", "verified", "approved", "stale"].map((s) => (
              <a key={s} href={`?${s ? `status=${s}` : ""}`} className={`mono rounded-full px-2.5 py-1 uppercase tracking-[0.08em] ring-1 ring-inset ${filter === s || (!filter && !s) ? "bg-lime text-bg ring-lime" : "text-fg-2 ring-line hover:ring-fg-muted"}`}>
                {s || "all"}
              </a>
            ))}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {FACT_CATEGORIES.map((cat) => {
            const facts = d.facts.filter((f) => f.category === cat.key);
            return (
              <Card key={cat.key} title={<>{cat.label}{cat.sensitive ? <span className="ml-2 normal-case text-amber-700">admin approves</span> : null}</>}>
                {facts.length === 0 ? <Empty>No facts in this category yet.</Empty> : null}
                <ul className="divide-y divide-neutral-100">
                  {facts.map((f) => (
                    <li key={f.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{f.statement}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {f.sourceTitle ? (
                              <>Source: {f.sourceUrl ? <a className="underline" href={f.sourceUrl}>{f.sourceTitle}</a> : f.sourceTitle}</>
                            ) : (
                              <span className="text-amber-700">No source attached</span>
                            )}
                            {f.sourceQuote ? <span className="block italic">“{f.sourceQuote}”</span> : null}
                            {f.approvedBy ? <span className="block">Approved by {f.approvedBy} on {fmtDate(f.approvedAt)}</span> : f.verifiedBy ? <span className="block">Verified by {f.verifiedBy}</span> : null}
                            {f.reviewDue ? <span className="block">Review due {fmtDate(f.reviewDue)}</span> : null}
                            <span className="block">v{f.version} · proposed by {f.proposedByKind === "agent" ? <AgentTag /> : "team"}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Chip value={f.status} />
                          {canReview ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              {f.status === "proposed" ? (
                                <ActionButton action={setFactStatus.bind(null, slug, f.id, "verified")} className="text-xs underline">verify</ActionButton>
                              ) : null}
                              {f.status !== "approved" && f.status !== "stale" && (isAdmin || !cat.sensitive) ? (
                                <ActionButton action={setFactStatus.bind(null, slug, f.id, "approved")} className="text-xs underline">approve</ActionButton>
                              ) : null}
                              {f.status !== "stale" ? (
                                <ActionButton action={setFactStatus.bind(null, slug, f.id, "stale")} className="text-xs text-neutral-500 underline">mark stale</ActionButton>
                              ) : (
                                <ActionButton action={setFactStatus.bind(null, slug, f.id, "proposed")} className="text-xs underline">reopen</ActionButton>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {canReview ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-neutral-500">edit</summary>
                          <ActionForm action={editFact.bind(null, slug, f.id)} className="mt-2 space-y-2" resetOnSuccess={false}>
                            <textarea name="statement" defaultValue={f.statement} className={input} rows={3} />
                            <input name="source_quote" defaultValue={f.sourceQuote ?? ""} placeholder="Source quote" className={input} />
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-neutral-500">Review due</label>
                              <input type="date" name="review_due" defaultValue={f.reviewDue?.slice(0, 10) ?? ""} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
                              <button className={btnSecondary}>Save (creates a new version)</button>
                            </div>
                          </ActionForm>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
        <div className="space-y-6">
          <Card title="Propose a fact">
            <ActionForm action={proposeFact.bind(null, slug)} className="space-y-2">
              <input type="hidden" name="client_id" value={client.id} />
              <select name="category" className={input}>
                {FACT_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <textarea name="statement" placeholder="State the fact plainly" className={input} rows={3} required />
              <select name="source_id" className={input}>
                <option value="">Source (recommended)</option>
                {d.sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
              <input name="source_quote" placeholder="Quote or location in the source" className={input} />
              <button className={btnPrimary}>Propose</button>
            </ActionForm>
          </Card>
          <Card title="Sources">
            <ul className="space-y-1 text-sm">
              {d.sources.map((s) => (
                <li key={s.id}>
                  {s.url ? <a className="underline" href={s.url}>{s.title}</a> : s.title}
                  <span className="ml-1 text-xs text-neutral-500">{s.kind.replace("_", " ")} · {fmtDate(s.capturedAt)}</span>
                </li>
              ))}
            </ul>
            {canReview ? (
              <ActionForm action={addSource.bind(null, slug)} className="mt-3 space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <input name="title" placeholder="Source title" className={input} required />
                <input name="url" placeholder="URL (optional)" className={input} />
                <select name="kind" className={input}>
                  {["link", "upload", "transcript", "platform_report", "contract", "note"].map((k) => (
                    <option key={k} value={k}>{k.replace("_", " ")}</option>
                  ))}
                </select>
                <button className={btnSecondary}>Add source</button>
              </ActionForm>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
