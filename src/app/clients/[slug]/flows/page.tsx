import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { REBUILD_STATUSES, clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { draftFlowLogic, proposeChange, runLinkCheck, setChangeStatus, syncFlows, updateFlow } from "./actions";

type Msg = { id: string; flowId: string; externalId: string; channel: string; name: string; subject: string | null; fromLabel: string | null; externalStatus: string | null; links: { href: string }[]; checks: { old_domain?: string[]; old_brand?: string[]; sender_old_brand?: boolean; unreachable?: string[]; checked_at?: string }; lastSyncedAt: string | null };

const STANDARD_JOURNEY = ["welcome", "browse", "cart", "checkout", "post-purchase", "second purchase", "replenishment", "winback", "sunset", "back in stock", "vip", "subscription onboarding"];

export const maxDuration = 300;

export default async function FlowsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const flows = await tx<{ id: string; externalId: string; name: string; triggerType: string | null; externalStatus: string | null; archived: boolean; documentedLogic: string | null; rebuildStatus: string; designUrl: string | null; lastSyncedAt: string | null }[]>`
      select id, external_id, name, trigger_type, external_status, archived, documented_logic, rebuild_status, design_url, last_synced_at
      from public.flows where client_id = ${client.id} order by external_status desc, name`;
    const changes = await tx<{ id: string; flowId: string; flowName: string; title: string; afterLogic: string; rationale: string | null; status: string; createdAt: string }[]>`
      select c.id, c.flow_id, f.name as flow_name, c.title, c.after_logic, c.rationale, c.status, c.created_at
      from public.proposed_changes c join public.flows f on f.id = c.flow_id where c.client_id = ${client.id} order by c.created_at desc`;
    const messages = await tx<Msg[]>`
      select id, flow_id, external_id, channel, name, subject, from_label, external_status, links, checks, last_synced_at from public.flow_messages where client_id = ${client.id} order by name`;
    return { role, flows, changes, messages };
  });
  const canEdit = d.role === "admin" || d.role === "account_lead";
  const isAdmin = d.role === "admin";
  const live = d.flows.filter((f) => f.externalStatus === "live" && !f.archived);
  const covered = STANDARD_JOURNEY.filter((j) => live.some((f) => f.name.toLowerCase().includes(j.split(" ")[0])));
  const missing = STANDARD_JOURNEY.filter((j) => !covered.includes(j));

  return (
    <>
      <PageHeader
        title={`${client.name} · Flows`}
        subtitle={<>{live.length} live · {d.flows.length} total · last sync {fmtDate(d.flows[0]?.lastSyncedAt)} · never edit a live flow in place (SOP 5)</>}
        actions={canEdit ? <div className="flex gap-2"><ActionButton action={syncFlows.bind(null, slug, client.id)} className={btnSecondary}>Sync from Klaviyo</ActionButton><ActionButton action={runLinkCheck.bind(null, slug, client.id)} className={btnSecondary}>Run link check</ActionButton></div> : null}
      />
      <Card title="Journey coverage (name-based, confirm manually)" className="mb-6">
        <p className="text-sm">
          <span className="text-emerald-800">Covered:</span> {covered.join(", ") || "none"}
          <br />
          <span className="text-amber-800">Missing:</span> {missing.join(", ") || "none"}
        </p>
      </Card>
      <div className="space-y-4">
        {d.flows.length === 0 ? <Empty>No flows. Sync from Klaviyo.</Empty> : null}
        {d.flows.map((f) => (
          <Card key={f.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium">{f.name}</h3>
                <p className="text-xs text-neutral-500">
                  {f.triggerType ?? "—"} · Klaviyo {f.externalStatus} · <a className="underline" href={`https://www.klaviyo.com/flow/${f.externalId}/edit`}>open in Klaviyo</a>
                  {f.designUrl ? <> · <a className="underline" href={f.designUrl}>design</a></> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Chip value={f.rebuildStatus} />
                {canEdit ? (
                  <ActionForm action={updateFlow.bind(null, slug, f.id)} className="flex items-center gap-1" resetOnSuccess={false}>
                    <select name="rebuild_status" defaultValue={f.rebuildStatus} className="rounded border border-neutral-300 px-2 py-1 text-xs">
                      {REBUILD_STATUSES.map((s) => <option key={s} value={s} disabled={s === "live" && !isAdmin}>{s.replaceAll("_", " ")}{s === "live" ? " (admin)" : ""}</option>)}
                    </select>
                    <button className="text-xs underline">set</button>
                  </ActionForm>
                ) : null}
              </div>
            </div>
            {(() => {
              const msgs = d.messages.filter((m) => m.flowId === f.id);
              if (!msgs.length) return null;
              return (
                <div className="mt-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Messages · checked {fmtDate(msgs[0].checks.checked_at ?? msgs[0].lastSyncedAt)}</p>
                  <ul className="divide-y divide-line-soft rounded-md border border-line-soft text-xs">
                    {msgs.map((m) => {
                      const bad = (m.checks.old_domain?.length ?? 0) + (m.checks.old_brand?.length ?? 0) + (m.checks.sender_old_brand ? 1 : 0);
                      return (
                        <li key={m.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                          <span className={`mono ${bad ? "text-coral" : "text-emerald-700"}`}>{bad ? `✕ ${bad}` : "✓"}</span>
                          <Chip value={m.channel} />
                          <span className="font-medium">{m.name}</span>
                          <span className="mono text-fg-muted">{m.externalId}{m.externalStatus !== "live" ? " · not live" : ""}</span>
                          {m.subject ? <span className="text-fg-2">“{m.subject}”</span> : null}
                          {m.fromLabel ? <span className="mono text-fg-muted">from {m.fromLabel}</span> : null}
                          <span className="mono text-fg-muted">{m.links.length} links</span>
                          {m.checks.old_domain?.length ? <span className="text-coral">off-domain: {m.checks.old_domain.slice(0, 3).join(", ")}</span> : null}
                          {m.checks.old_brand?.length ? <span className="text-coral">old brand: {m.checks.old_brand.join(", ")}</span> : null}
                          {m.checks.sender_old_brand ? <span className="text-coral">old-brand sender</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Documented logic</p>
                {canEdit ? (
                  <ActionForm action={updateFlow.bind(null, slug, f.id)} resetOnSuccess={false}>
                    <textarea name="documented_logic" defaultValue={f.documentedLogic ?? ""} rows={6} className={input} placeholder="Trigger, filters, exclusions, timing, offer, links…" />
                    <div className="mt-1 flex gap-2">
                      <button className={btnSecondary}>Save logic</button>
                    </div>
                  </ActionForm>
                ) : (
                  <pre className="whitespace-pre-wrap rounded bg-bg-3 p-2 text-xs">{f.documentedLogic ?? "Not documented."}</pre>
                )}
                {canEdit && !f.documentedLogic ? (
                  <div className="mt-1">
                    <ActionButton action={draftFlowLogic.bind(null, slug, client.id, f.id)} className="text-xs text-violet-700 underline">Ask the agent to draft the logic from Klaviyo</ActionButton>
                  </div>
                ) : null}
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Design reference</p>
                <ActionForm action={updateFlow.bind(null, slug, f.id)} className="flex gap-2" resetOnSuccess={false}>
                  <input name="design_url" defaultValue={f.designUrl ?? ""} placeholder="Figma link" className={input} />
                  <button className={btnSecondary}>Save</button>
                </ActionForm>
                {canEdit ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs underline">Propose a change</summary>
                    <ActionForm action={proposeChange.bind(null, slug)} className="mt-2 space-y-2">
                      <input type="hidden" name="client_id" value={client.id} />
                      <input type="hidden" name="flow_id" value={f.id} />
                      <input name="title" placeholder="Change title" className={input} required />
                      <textarea name="before_logic" placeholder="Before (optional)" className={input} rows={2} />
                      <textarea name="after_logic" placeholder="After — what the flow should do" className={input} rows={3} required />
                      <input name="rationale" placeholder="Why (link evidence)" className={input} />
                      <button className={btnPrimary}>Propose</button>
                    </ActionForm>
                  </details>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Proposed changes" className="mt-6">
        {d.changes.length === 0 ? <Empty>No proposed changes.</Empty> : null}
        <ul className="divide-y divide-neutral-100">
          {d.changes.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">{c.title} <span className="font-normal text-neutral-500">· {c.flowName}</span></p>
                <p className="text-sm text-neutral-700">{c.afterLogic}</p>
                {c.rationale ? <p className="text-xs text-neutral-500">{c.rationale}</p> : null}
              </div>
              <div className="flex flex-col items-end gap-1">
                <Chip value={c.status} />
                {isAdmin && c.status === "proposed" ? (
                  <div className="flex gap-2">
                    <ActionButton action={setChangeStatus.bind(null, slug, c.id, "approved")} className="text-xs underline">approve</ActionButton>
                    <ActionButton action={setChangeStatus.bind(null, slug, c.id, "rejected")} className="text-xs text-red-700 underline">reject</ActionButton>
                  </div>
                ) : null}
                {c.status === "approved" ? (
                  <ActionButton action={setChangeStatus.bind(null, slug, c.id, "applied")} className="text-xs underline">mark applied (needs publish permission)</ActionButton>
                ) : null}
                {c.status === "applied" && canEdit ? (
                  <ActionButton action={setChangeStatus.bind(null, slug, c.id, "verified")} className="text-xs underline">mark verified</ActionButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
