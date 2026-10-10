import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, Table, btnPrimary, btnSecondary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { addSlot, createCycle, createStandaloneBrief, setCycleStatus } from "./actions";

export default async function CalendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const cycles = await tx<{ id: string; startsOn: string; endsOn: string; objective: string | null; status: string; approvedBy: string | null }[]>`
      select c.id, c.starts_on, c.ends_on, c.objective, c.status, p.full_name as approved_by from public.cycles c left join public.profiles p on p.id = c.approved_by
      where c.client_id = ${client.id} order by c.starts_on desc`;
    const slots = await tx<{ id: string; cycleId: string; sendOn: string; channel: string; purpose: string; title: string; segment: string | null; offer: string | null; briefId: string | null; briefStatus: string | null; priority: number; audienceRule: string | null; exclusions: string | null; replacesSlotId: string | null }[]>`
      select s.id, s.cycle_id, s.send_on, s.channel, s.purpose, s.title, s.segment, f.statement as offer, b.id as brief_id, b.status as brief_status, s.priority, s.audience_rule, s.exclusions, s.replaces_slot_id
      from public.calendar_slots s left join public.facts f on f.id = s.offer_fact_id left join public.briefs b on b.slot_id = s.id
      where s.client_id = ${client.id} order by s.send_on`;
    const offers = await tx<{ id: string; statement: string }[]>`select id, statement from public.facts where client_id = ${client.id} and category = 'offers_discounts' and status = 'approved'`;
    const briefs = await tx<{ id: string; title: string; status: string; updatedAt: string; owner: string | null }[]>`
      select b.id, b.title, b.status, b.updated_at, p.full_name as owner from public.briefs b left join public.profiles p on p.id = b.owner_id where b.client_id = ${client.id} order by b.updated_at desc`;
    const policy = (await tx<{ contactPolicy: { email_max_per_week: number; sms_max_per_week: number; promo_streak_max: number } }[]>`select contact_policy from public.clients where id = ${client.id}`)[0].contactPolicy;
    return { role, cycles, slots, offers, briefs, policy };
  });
  const canEdit = d.role === "admin" || d.role === "account_lead";
  const isAdmin = d.role === "admin";
  const current = d.cycles[0];

  return (
    <>
      <PageHeader title={`${client.name} · Calendar and briefs`} subtitle={<>Two-week cycles; every slot gets a brief; approval sits on a copy version (SOP 6, 7, 8). Contact policy enforced at approval: {d.policy.email_max_per_week} email / {d.policy.sms_max_per_week} SMS per week, no more than {d.policy.promo_streak_max} promotion in a row; conditional sends replace their base slot. <Link className="underline" href={`/clients/${slug}/strategy`}>Edit rules</Link></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {d.cycles.map((c) => {
            const slots = d.slots.filter((s) => s.cycleId === c.id);
            return (
              <Card key={c.id} title={<>Cycle {fmtDate(c.startsOn)} – {fmtDate(c.endsOn)} <Chip value={c.status} />{c.approvedBy ? <span className="ml-2 normal-case">approved by {c.approvedBy}</span> : null}</>}>
                <p className="mb-3 text-sm">{c.objective}</p>
                {canEdit ? (
                  <div className="mb-3 flex gap-2">
                    {c.status === "draft" ? <ActionButton action={setCycleStatus.bind(null, slug, c.id, "internal_review")} className={btnSecondary}>Submit for approval</ActionButton> : null}
                    {c.status === "internal_review" && isAdmin ? <ActionButton action={setCycleStatus.bind(null, slug, c.id, "approved")} className={btnPrimary}>Approve plan (admin)</ActionButton> : null}
                    {c.status === "approved" && isAdmin ? <ActionButton action={setCycleStatus.bind(null, slug, c.id, "active")} className={btnSecondary}>Activate</ActionButton> : null}
                    {c.status === "active" ? <ActionButton action={setCycleStatus.bind(null, slug, c.id, "closed")} className={btnSecondary}>Close cycle</ActionButton> : null}
                  </div>
                ) : null}
                {slots.length === 0 ? <Empty>No slots yet.</Empty> : (
                  <Table head={["Send", "Channel", "Purpose", "Campaign", "Audience", "Offer", "Brief"]}>
                    {slots.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2 pr-4">{fmtDate(s.sendOn)}</td>
                        <td className="py-2 pr-4 uppercase">{s.channel}</td>
                        <td className="py-2 pr-4">{s.purpose}</td>
                        <td className="py-2 pr-4">{s.title}{s.replacesSlotId ? <span className="ml-1 mono text-[10px] text-fg-muted">conditional · replaces {slots.find((x) => x.id === s.replacesSlotId)?.title ?? "a base send"}</span> : null}</td>
                        <td className="py-2 pr-4 text-xs">{s.segment ?? "—"}{s.audienceRule ? <span className="block text-fg-muted">{s.audienceRule}</span> : null}{s.exclusions ? <span className="block text-fg-muted">excl: {s.exclusions}</span> : null}<span className="block mono text-[10px] text-fg-muted">P{s.priority}</span></td>
                        <td className="py-2 pr-4 text-xs">{s.offer ?? "none"}</td>
                        <td className="py-2 pr-4">{s.briefId ? <Link className="underline" href={`/clients/${slug}/briefs/${s.briefId}`}><Chip value={s.briefStatus ?? "draft"} /></Link> : "—"}</td>
                      </tr>
                    ))}
                  </Table>
                )}
                {canEdit && c.status !== "closed" ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs underline">Add a slot</summary>
                    <ActionForm action={addSlot.bind(null, slug)} className="mt-2 grid gap-2 md:grid-cols-3">
                      <input type="hidden" name="client_id" value={client.id} />
                      <input type="hidden" name="cycle_id" value={c.id} />
                      <input type="date" name="send_on" className={input} required min={c.startsOn.slice(0, 10)} max={c.endsOn.slice(0, 10)} />
                      <select name="channel" className={input}><option value="email">Email</option><option value="sms">SMS</option></select>
                      <select name="purpose" className={input}>
                        {["education", "product", "promotion", "launch", "retention"].map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <input name="title" placeholder="Campaign title" className={input + " md:col-span-2"} required />
                      <input name="segment" placeholder="Segment" className={input} />
                      <input name="audience_rule" placeholder="Audience rule (who qualifies)" className={input} />
                      <input name="exclusions" placeholder="Exclusions (buyers, recovery entrants, flow-owned)" className={input} />
                      <select name="priority" className={input} defaultValue="3">{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>priority {p}{p === 1 ? " (highest)" : ""}</option>)}</select>
                      <select name="replaces_slot_id" className={input}><option value="">Base send (counts toward the cap)</option>{slots.map((x) => <option key={x.id} value={x.id}>conditional: replaces “{x.title}”</option>)}</select>
                      <select name="offer_fact_id" className={input + " md:col-span-2"}>
                        <option value="">No offer</option>
                        {d.offers.map((o) => <option key={o.id} value={o.id}>{o.statement.slice(0, 90)}</option>)}
                      </select>
                      <button className={btnPrimary}>Add slot + brief</button>
                      {d.offers.length === 0 ? <p className="text-xs text-amber-700 md:col-span-3">No Approved offer facts yet, so slots cannot carry an offer (SOP 7 rule).</p> : null}
                    </ActionForm>
                  </details>
                ) : null}
              </Card>
            );
          })}
          <Card title="All briefs">
            {d.briefs.length === 0 ? <Empty>No briefs.</Empty> : (
              <Table head={["Brief", "Status", "Owner", "Updated"]}>
                {d.briefs.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2 pr-4"><Link className="underline" href={`/clients/${slug}/briefs/${b.id}`}>{b.title}</Link></td>
                    <td className="py-2 pr-4"><Chip value={b.status} /></td>
                    <td className="py-2 pr-4">{b.owner ?? "—"}</td>
                    <td className="py-2 pr-4">{fmtDate(b.updatedAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          {canEdit ? (
            <Card title="New cycle">
              <ActionForm action={createCycle.bind(null, slug)} className="space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <input type="date" name="starts_on" className={input} required />
                <input type="date" name="ends_on" className={input} required />
                <textarea name="objective" placeholder="Cycle objective" className={input} rows={3} />
                <button className={btnSecondary}>Create cycle (draft)</button>
              </ActionForm>
            </Card>
          ) : null}
          {canEdit ? (
            <Card title="Brief without a slot">
              <form action={createStandaloneBrief.bind(null, slug)} className="space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <input name="title" placeholder="e.g. Welcome flow email 1" className={input} required />
                <button className={btnSecondary}>Create brief</button>
              </form>
              <p className="mt-2 text-xs text-neutral-500">Use for flow emails and one-offs; {current ? "calendar sends belong in the cycle." : "create a cycle for calendar sends."}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
