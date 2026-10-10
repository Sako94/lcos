import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, input, fmtDate } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { decide, linkDecision, openDecision } from "./actions";

type Decision = {
  id: string; statement: string; status: "open" | "decided" | "superseded"; ownerSide: string | null; ownerRole: string | null; ownerName: string | null;
  options: string[]; unlocks: string | null; dueOn: string | null; decidedOn: string | null; outcome: string | null; decidedBy: string | null; createdAt: string;
  links: { recordType: string; recordId: string; label: string | null }[];
};

export default async function DecisionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const decisions = await tx<Decision[]>`
      select d.id, d.statement, d.status, d.owner_side, d.owner_role, d.owner_name, d.options, d.unlocks, d.due_on, d.decided_on, d.outcome, d.decided_by, d.created_at,
        coalesce((select json_agg(json_build_object('recordType', l.record_type, 'recordId', l.record_id,
            'label', case l.record_type when 'finding' then (select title from public.findings where id = l.record_id)
                                        when 'brief' then (select title from public.briefs where id = l.record_id)
                                        when 'journey' then (select name from public.journeys where id = l.record_id)
                                        when 'experiment' then (select name from public.experiments where id = l.record_id)
                                        when 'target' then (select period || ' ' || metric_key from public.targets where id = l.record_id)
                                        else null end))
          from public.decision_links l where l.decision_id = d.id), '[]'::json) as links
      from public.decisions d where d.client_id = ${client.id}
      order by case d.status when 'open' then 0 when 'decided' then 1 else 2 end, d.due_on nulls last, d.created_at desc`;
    const findings = await tx<{ id: string; title: string }[]>`select id, title from public.findings where client_id = ${client.id} and status in ('new','confirmed','promoted') order by severity, created_at desc limit 40`;
    return { role, decisions, findings };
  });
  const canEdit = d.role === "admin" || d.role === "account_lead";
  const open = d.decisions.filter((x) => x.status === "open"), done = d.decisions.filter((x) => x.status !== "open");

  return (
    <>
      <PageHeader title={`${client.name} · Decisions`} subtitle="Every blocked piece of work names the person who has to decide, what it unlocks, and when. A decision is closed only with its outcome and who made it." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title={`Open · ${open.length}`}>
            {open.length === 0 ? <Empty>Nothing is waiting on a decision.</Empty> : null}
            <ul className="divide-y divide-neutral-100">
              {open.map((x) => (
                <li key={x.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{x.statement}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        {x.ownerSide ? <Chip value={x.ownerSide} /> : null}
                        {x.ownerRole ? <span className="mono text-fg-muted">{x.ownerRole}{x.ownerName ? ` · ${x.ownerName}` : ""}</span> : null}
                        {x.dueOn ? <span className={`mono ${x.dueOn < new Date().toISOString().slice(0, 10) ? "text-coral" : "text-fg-muted"}`}>due {fmtDate(x.dueOn)}</span> : null}
                      </div>
                      {x.unlocks ? <p className="mt-1 text-sm text-fg-2"><span className="label mr-1">unlocks</span>{x.unlocks}</p> : null}
                      {x.options.length ? <ul className="mt-1 list-disc pl-5 text-sm text-fg-2">{x.options.map((o, i) => <li key={i}>{o}</li>)}</ul> : null}
                      {x.links.length ? <p className="mt-1 text-xs text-fg-muted">blocks: {x.links.map((l) => `${l.recordType} · ${l.label ?? l.recordId.slice(0, 8)}`).join("; ")}</p> : null}
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <ActionForm action={decide.bind(null, slug, x.id)} className="flex flex-wrap gap-1">
                        <input name="outcome" placeholder="Outcome (what was decided)" className={`${input} flex-1`} required />
                        <input name="decided_by" placeholder="Decided by" className={`${input} w-36`} required />
                        <button className={btnPrimary}>Record decision</button>
                      </ActionForm>
                      <ActionForm action={linkDecision.bind(null, slug, client.id, x.id)} className="flex gap-1">
                        <input type="hidden" name="record_type" value="finding" />
                        <select name="record_id" className={input} required><option value="">Link a finding this blocks…</option>{d.findings.map((f) => <option key={f.id} value={f.id}>{f.title.slice(0, 70)}</option>)}</select>
                        <button className={btnSecondary}>Link</button>
                      </ActionForm>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`Decided · ${done.length}`}>
            {done.length === 0 ? <Empty>No decisions recorded yet.</Empty> : null}
            <ul className="divide-y divide-neutral-100">
              {done.map((x) => (
                <li key={x.id} className="py-2 text-sm">
                  <p className="font-medium">{x.statement}</p>
                  <p className="text-fg-2">{x.outcome ?? ""} <span className="mono text-xs text-fg-muted">· {x.decidedBy ?? "—"} · {fmtDate(x.decidedOn ?? x.createdAt)}</span></p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div>
          {canEdit ? (
            <Card title="Open a decision">
              <ActionForm action={openDecision.bind(null, slug, client.id)} className="space-y-2">
                <textarea name="statement" placeholder="What has to be decided" className={input} rows={2} required />
                <div className="grid grid-cols-2 gap-2">
                  <select name="owner_side" className={input}><option value="client">Client decides</option><option value="agency">Wavy decides</option></select>
                  <input name="due_on" type="date" className={input} />
                </div>
                <input name="owner_role" placeholder="Owner role (e.g. client commercial owner)" className={input} />
                <input name="owner_name" placeholder="Owner name (optional)" className={input} />
                <input name="unlocks" placeholder="What it unlocks" className={input} />
                <textarea name="options" placeholder="Options, one per line" className={input} rows={3} />
                <select name="record_id" className={input}><option value="">Blocks a finding (optional)…</option>{d.findings.map((f) => <option key={f.id} value={f.id}>{f.title.slice(0, 70)}</option>)}</select>
                <input type="hidden" name="record_type" value="finding" />
                <button className={btnPrimary}>Open</button>
              </ActionForm>
            </Card>
          ) : null}
          <Card title="How this works" className="mt-6">
            <p className="text-sm text-fg-2">The agent can open a decision when a finding needs an input it cannot get from data. Only a person can record the outcome. If a decision changes an Approved fact, that fact reopens as Proposed (SOP 2 and SOP 9).</p>
          </Card>
        </div>
      </div>
    </>
  );
}
