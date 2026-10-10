import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { addJourney, addStep, mapStepToFlow, setJourneyStatus, setStepStatus } from "./actions";

const STAGES: { key: string; label: string }[] = [
  { key: "capture", label: "01 · Capture & choose" }, { key: "welcome", label: "02 · Welcome & first purchase" }, { key: "recover_intent", label: "03 · Recover intent" },
  { key: "deliver_routine", label: "04 · Deliver & build the routine" }, { key: "second_purchase", label: "05 · Earn the second purchase" },
  { key: "retain_reconnect", label: "06 · Retain & reconnect" }, { key: "advocacy", label: "07 · Learn & earn advocacy" },
];

type Step = { id: string; position: number; channel: string; name: string; anchor: string; delayHours: number; subject: string | null; draftBody: string | null; doNotSend: string[]; bindings: { token: string; fact_id: string }[]; status: string; currentFlowId: string | null; currentFlowName: string | null; unresolved: number };
type Journey = { id: string; stage: string; name: string; purpose: string | null; entryCondition: string | null; exitCondition: string | null; status: string; steps: Step[] };

export default async function JourneysPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const journeys = await tx<Journey[]>`
      select j.id, j.stage, j.name, j.purpose, j.entry_condition, j.exit_condition, j.status,
        coalesce((select json_agg(json_build_object('id', st.id, 'position', st.position, 'channel', st.channel, 'name', st.name, 'anchor', st.anchor, 'delayHours', st.delay_hours,
            'subject', st.subject, 'draftBody', st.draft_body, 'doNotSend', st.do_not_send, 'bindings', st.bindings, 'status', st.status, 'currentFlowId', st.current_flow_id,
            'currentFlowName', (select name from public.flows f where f.id = st.current_flow_id),
            'unresolved', (select count(*) from jsonb_array_elements(st.bindings) b where not exists (select 1 from public.facts f where f.id::text = b->>'fact_id' and f.status = 'approved')))
          order by st.position) from public.journey_steps st where st.journey_id = j.id), '[]'::json) as steps
      from public.journeys j where j.client_id = ${client.id} order by j.sort_order, j.created_at`;
    const flows = await tx<{ id: string; name: string; externalStatus: string | null }[]>`select id, name, external_status from public.flows where client_id = ${client.id} and not archived order by name`;
    const facts = await tx<{ id: string; statement: string; category: string }[]>`select id, statement, category from public.facts where client_id = ${client.id} and status = 'approved' order by category, statement`;
    return { role, journeys, flows, facts };
  });
  const canEdit = d.role === "admin" || d.role === "account_lead";
  const isAdmin = d.role === "admin";
  const totalSteps = d.journeys.reduce((n, j) => n + j.steps.length, 0);
  const mapped = d.journeys.reduce((n, j) => n + j.steps.filter((s) => s.currentFlowId).length, 0);
  const liveFlows = d.flows.filter((f) => f.externalStatus === "live");
  const coveredFlowIds = new Set(d.journeys.flatMap((j) => j.steps.map((s) => s.currentFlowId)).filter(Boolean));

  return (
    <>
      <PageHeader
        title={`${client.name} · Target journeys`}
        subtitle="What the program should be, stage by stage, next to what Klaviyo has today. Each step has an entry, a clock, do-not-send rules and token bindings that must resolve to Approved facts before it is approved."
      />
      <div className="mb-6 grid gap-3 md:grid-cols-4">
        {[["Stages", String(d.journeys.length)], ["Planned steps", String(totalSteps)], ["Steps mapped to a live flow", `${mapped} / ${totalSteps}`], ["Live flows not in any journey", String(liveFlows.filter((f) => !coveredFlowIds.has(f.id)).length)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-bg-2 px-4 py-3"><p className="label">{k}</p><p className="mono text-xl text-lime">{v}</p></div>
        ))}
      </div>
      <div className="space-y-6">
        {STAGES.map((stage) => {
          const js = d.journeys.filter((j) => j.stage === stage.key);
          return (
            <Card key={stage.key} title={stage.label}>
              {js.length === 0 ? <Empty>No journey defined for this stage yet.</Empty> : null}
              {js.map((j) => (
                <div key={j.id} className="mb-4 rounded-lg border border-line-soft p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{j.name}</span> <Chip value={j.status} />
                      {j.purpose ? <p className="text-sm text-fg-2">{j.purpose}</p> : null}
                      <p className="mono text-[11px] text-fg-muted">entry: {j.entryCondition ?? "—"} · exit: {j.exitCondition ?? "—"}</p>
                    </div>
                    <div className="flex gap-2">
                      {isAdmin && j.status === "proposed" ? <ActionButton action={setJourneyStatus.bind(null, slug, j.id, "approved")} className={btnPrimary}>Approve (admin)</ActionButton> : null}
                      {canEdit && j.status === "approved" ? <ActionButton action={setJourneyStatus.bind(null, slug, j.id, "building")} className={btnSecondary}>Mark building</ActionButton> : null}
                    </div>
                  </div>
                  <ol className="mt-3 space-y-2">
                    {j.steps.map((s) => (
                      <li key={s.id} className="rounded-md border border-line-soft bg-bg-3 p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mono text-xs text-lime">{String(s.position).padStart(2, "0")}</span>
                          <Chip value={s.channel} />
                          <span className="font-medium">{s.name}</span>
                          <span className="mono text-[11px] text-fg-muted">{s.anchor} +{s.delayHours}h</span>
                          <Chip value={s.status} />
                          {s.unresolved > 0 ? <span className="mono text-[11px] text-amber-700">{s.unresolved} binding(s) unresolved</span> : null}
                          {s.currentFlowName ? <span className="mono text-[11px] text-teal">↔ {s.currentFlowName}</span> : <span className="mono text-[11px] text-coral">no live flow</span>}
                        </div>
                        {s.subject ? <p className="mt-1 text-fg-2">Subject: {s.subject}</p> : null}
                        {s.draftBody ? <details className="mt-1"><summary className="cursor-pointer text-xs text-fg-muted">draft</summary><pre className="whitespace-pre-wrap text-xs text-fg-2">{s.draftBody}</pre></details> : null}
                        {s.doNotSend.length ? <p className="mt-1 text-xs text-fg-muted">do not send when: {s.doNotSend.join("; ")}</p> : null}
                        {s.bindings.length ? <p className="mt-1 text-xs text-fg-muted">bindings: {s.bindings.map((b) => `[[${b.token}]]`).join(" ")}</p> : null}
                        {canEdit ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {s.status === "proposed" ? <ActionButton action={setStepStatus.bind(null, slug, s.id, "approved")} className="text-xs underline">approve step</ActionButton> : null}
                            {s.status === "approved" ? <ActionButton action={setStepStatus.bind(null, slug, s.id, "built")} className="text-xs underline">mark built</ActionButton> : null}
                            {s.status === "built" && user.canPublish ? <ActionButton action={setStepStatus.bind(null, slug, s.id, "live")} className="text-xs underline">set live (publisher)</ActionButton> : null}
                            <ActionForm action={mapStepToFlow.bind(null, slug, s.id)} className="flex gap-1">
                              <select name="current_flow_id" className={`${input} w-56 py-1 text-xs`} defaultValue={s.currentFlowId ?? ""}><option value="">map to current flow…</option>{d.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                              <button className="text-xs underline">map</button>
                            </ActionForm>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {canEdit ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-fg-muted">Add a step</summary>
                      <ActionForm action={addStep.bind(null, slug, client.id, j.id)} className="mt-2 grid gap-2 md:grid-cols-2">
                        <input name="name" placeholder="Step name" className={input} required />
                        <div className="flex gap-2">
                          <select name="channel" className={input}><option value="email">email</option><option value="sms">sms</option></select>
                          <input name="anchor" placeholder="anchor (entry | previous_step | event:…)" className={input} />
                          <input name="delay_hours" type="number" min={0} placeholder="+h" className={`${input} w-20`} />
                        </div>
                        <input name="subject" placeholder="Subject (email) or first line (SMS)" className={input} />
                        <select name="current_flow_id" className={input}><option value="">Current flow that does this today (optional)</option>{d.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                        <textarea name="draft_body" placeholder="Draft body; use [[TOKEN]] for anything that must bind to an Approved fact" className={`${input} md:col-span-2`} rows={4} />
                        <textarea name="do_not_send" placeholder={"Do-not-send rules, one per line\nOpt-out or suppression\nOpen service case\nHigher-priority journey owns the contact slot"} className={input} rows={3} />
                        <textarea name="bindings" placeholder={"Bindings, one per line as TOKEN=fact id\nACCEPTED_BENEFIT=" + (d.facts[0]?.id ?? "<fact id>")} className={input} rows={3} />
                        <button className={`${btnPrimary} md:col-span-2 justify-self-start`}>Add step</button>
                      </ActionForm>
                    </details>
                  ) : null}
                </div>
              ))}
              {canEdit ? (
                <details>
                  <summary className="cursor-pointer text-xs text-fg-muted">Add a journey to this stage</summary>
                  <ActionForm action={addJourney.bind(null, slug, client.id)} className="mt-2 grid gap-2 md:grid-cols-2">
                    <input type="hidden" name="stage" value={stage.key} />
                    <input name="name" placeholder="Journey name" className={input} required />
                    <input name="purpose" placeholder="Purpose" className={input} />
                    <input name="entry_condition" placeholder="Entry condition" className={input} />
                    <input name="exit_condition" placeholder="Exit condition" className={input} />
                    <button className={`${btnSecondary} justify-self-start`}>Add journey</button>
                  </ActionForm>
                </details>
              ) : null}
            </Card>
          );
        })}
        <Card title="Approved facts available for bindings">
          {d.facts.length === 0 ? <Empty>No Approved facts yet; bindings cannot resolve until facts are approved on the Source of Truth.</Empty> : null}
          <ul className="grid gap-1 text-xs md:grid-cols-2">{d.facts.map((f) => <li key={f.id}><span className="mono text-fg-muted">{f.id.slice(0, 8)}</span> · {f.statement.slice(0, 90)}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
