import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { proposeTarget, saveContactPolicy, setLeverGate, setTargetStatus } from "./actions";

type Lever = { name: string; amount: number; gate: string; gate_status: "open" | "passed" | "failed" };
type Target = { id: string; period: string; metricKey: string; metricName: string; floorValue: number | null; recordValue: number | null; stretchValue: number | null; basis: string | null; levers: Lever[]; status: string; evidenceClass: string; approvedBy: string | null };
type Policy = { email_max_per_week: number; sms_max_per_week: number; promo_streak_max: number; quiet_hours: { start: string; end: string; tz: string }; collision_rule: string };

const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export default async function StrategyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const targets = await tx<Target[]>`
      select t.id, t.period, t.metric_key, m.name as metric_name, t.floor_value, t.record_value, t.stretch_value, t.basis, t.levers, t.status, t.evidence_class, p.full_name as approved_by
      from public.targets t join public.metric_definitions m on m.key = t.metric_key left join public.profiles p on p.id = t.approved_by
      where t.client_id = ${client.id} order by t.period desc, t.metric_key`;
    const c = (await tx<{ contactPolicy: Policy; approvedDomains: string[]; oldBrandTerms: string[] }[]>`select contact_policy, approved_domains, old_brand_terms from public.clients where id = ${client.id}`)[0];
    const metrics = await tx<{ key: string; name: string }[]>`select key, name from public.metric_definitions order by name`;
    return { role, targets, policy: c.contactPolicy, approvedDomains: c.approvedDomains, oldBrandTerms: c.oldBrandTerms, metrics };
  });
  const isAdmin = d.role === "admin";
  const canEdit = isAdmin || d.role === "account_lead";

  return (
    <>
      <PageHeader title={`${client.name} · Strategy`} subtitle="Targets are modeled, not promised: a floor, a record case and a stretch, each built from levers with a gate that has to pass before its amount counts. The contact policy below is enforced when a cycle plan is approved." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Targets">
            {d.targets.length === 0 ? <Empty>No target proposed yet.</Empty> : null}
            {d.targets.map((t) => {
              const passed = t.levers.filter((l) => l.gate_status === "passed").reduce((n, l) => n + l.amount, 0);
              return (
                <div key={t.id} className="mb-4 rounded-lg border border-line-soft p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t.period} · {t.metricName}</span>
                    <Chip value={t.status} /><Chip value={t.evidenceClass} />
                    {t.approvedBy ? <span className="mono text-[11px] text-fg-muted">approved by {t.approvedBy}</span> : null}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    {[["Floor", t.floorValue], ["Record", t.recordValue], ["Stretch", t.stretchValue]].map(([k, v]) => (
                      <div key={String(k)} className="rounded-md bg-bg-3 py-2"><p className="label">{k}</p><p className="mono text-lg">{usd(v as number | null)}</p></div>
                    ))}
                  </div>
                  {t.basis ? <p className="mt-2 text-xs text-fg-muted">{t.basis}</p> : null}
                  <p className="mt-2 text-xs text-fg-2">Gated amount earned so far: <span className="mono text-lime">{usd(passed)}</span> of {usd(t.levers.reduce((n, l) => n + l.amount, 0))} modeled.</p>
                  <ul className="mt-1 divide-y divide-neutral-100 text-sm">
                    {t.levers.map((l, i) => (
                      <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <div><span className="font-medium">{l.name}</span> <span className="mono text-xs text-fg-muted">{usd(l.amount)}</span><p className="text-xs text-fg-2">gate: {l.gate || "—"}</p></div>
                        <div className="flex items-center gap-2">
                          <Chip value={l.gate_status} />
                          {canEdit ? (<>
                            <ActionButton action={setLeverGate.bind(null, slug, t.id, i, "passed")} className="text-xs underline">passed</ActionButton>
                            <ActionButton action={setLeverGate.bind(null, slug, t.id, i, "failed")} className="text-xs underline">failed</ActionButton>
                          </>) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {isAdmin && t.status === "proposed" ? <ActionButton action={setTargetStatus.bind(null, slug, t.id, "approved")} className={`${btnPrimary} mt-2`}>Approve target (admin)</ActionButton> : null}
                </div>
              );
            })}
          </Card>
          <Card title="Contact policy and brand rules">
            <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
              <dt className="label">email cap / week</dt><dd className="mono">{d.policy.email_max_per_week}</dd>
              <dt className="label">sms cap / week</dt><dd className="mono">{d.policy.sms_max_per_week}</dd>
              <dt className="label">promotions in a row</dt><dd className="mono">{d.policy.promo_streak_max}</dd>
              <dt className="label">quiet hours</dt><dd className="mono">{d.policy.quiet_hours?.start}–{d.policy.quiet_hours?.end} {d.policy.quiet_hours?.tz}</dd>
              <dt className="label">approved link domains</dt><dd className="mono">{d.approvedDomains.join(", ") || "none set (link check accepts all)"}</dd>
              <dt className="label">old-brand terms</dt><dd className="mono">{d.oldBrandTerms.join(", ") || "none"}</dd>
            </dl>
            <p className="mt-2 text-sm text-fg-2">{d.policy.collision_rule}</p>
            {isAdmin ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-fg-muted">Edit (admin)</summary>
                <ActionForm action={saveContactPolicy.bind(null, slug, client.id)} className="mt-2 grid gap-2 md:grid-cols-3" resetOnSuccess={false}>
                  <input name="email_max_per_week" type="number" defaultValue={d.policy.email_max_per_week} className={input} />
                  <input name="sms_max_per_week" type="number" defaultValue={d.policy.sms_max_per_week} className={input} />
                  <input name="promo_streak_max" type="number" defaultValue={d.policy.promo_streak_max} className={input} />
                  <input name="quiet_start" defaultValue={d.policy.quiet_hours?.start} className={input} />
                  <input name="quiet_end" defaultValue={d.policy.quiet_hours?.end} className={input} />
                  <input name="tz" defaultValue={d.policy.quiet_hours?.tz} className={input} />
                  <textarea name="collision_rule" defaultValue={d.policy.collision_rule} className={`${input} md:col-span-3`} rows={2} />
                  <input name="approved_domains" defaultValue={d.approvedDomains.join(", ")} placeholder="approved domains, comma separated" className={`${input} md:col-span-3`} />
                  <textarea name="old_brand_terms" defaultValue={d.oldBrandTerms.join("\n")} placeholder="old-brand terms, one per line" className={`${input} md:col-span-3`} rows={2} />
                  <button className={`${btnSecondary} justify-self-start`}>Save rules</button>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        </div>
        <div>
          {canEdit ? (
            <Card title="Propose a target">
              <ActionForm action={proposeTarget.bind(null, slug, client.id)} className="space-y-2">
                <input name="period" placeholder="Period (2026-Q4)" className={input} required />
                <select name="metric_key" className={input} required>{d.metrics.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
                <div className="grid grid-cols-3 gap-2">
                  <input name="floor_value" type="number" placeholder="Floor" className={input} />
                  <input name="record_value" type="number" placeholder="Record" className={input} />
                  <input name="stretch_value" type="number" placeholder="Stretch" className={input} />
                </div>
                <textarea name="basis" placeholder="How the numbers were built (run-rate + levers − reserve)" className={input} rows={2} />
                <textarea name="levers" placeholder={"Levers, one per line: name | amount | gate\nBFCM opening | 71800 | 35,000 qualified recipients confirmed"} className={input} rows={4} />
                <button className={btnPrimary}>Propose</button>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
