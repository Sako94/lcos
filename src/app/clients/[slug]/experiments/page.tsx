import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, input, fmtDate } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { proposeExperiment, setExperimentStatus } from "./actions";

type Exp = {
  id: string; name: string; hypothesis: string; treatment: string | null; control: string | null; primaryMetric: string | null; metricName: string | null; minSample: number | null;
  stopRule: string | null; startsOn: string | null; readoutOn: string | null; status: string; predeclaredAt: string | null; conclusion: string | null; result: { note?: string } | null;
  findingTitle: string | null; owner: string | null; approvedBy: string | null;
};

export default async function ExperimentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const experiments = await tx<Exp[]>`
      select e.id, e.name, e.hypothesis, e.treatment, e.control, e.primary_metric, m.name as metric_name, e.min_sample, e.stop_rule, e.starts_on, e.readout_on, e.status, e.predeclared_at, e.conclusion, e.result,
             f.title as finding_title, po.full_name as owner, pa.full_name as approved_by
      from public.experiments e left join public.metric_definitions m on m.key = e.primary_metric left join public.findings f on f.id = e.finding_id
      left join public.profiles po on po.id = e.owner_id left join public.profiles pa on pa.id = e.approved_by
      where e.client_id = ${client.id}
      order by case e.status when 'running' then 0 when 'readout' then 1 when 'approved' then 2 when 'proposed' then 3 else 4 end, e.readout_on nulls last`;
    const metrics = await tx<{ key: string; name: string }[]>`select key, name from public.metric_definitions order by name`;
    const findings = await tx<{ id: string; title: string }[]>`select id, title from public.findings where client_id = ${client.id} and status in ('confirmed','promoted') order by created_at desc limit 40`;
    return { role, experiments, metrics, findings };
  });
  const canEdit = d.role === "admin" || d.role === "account_lead";

  return (
    <>
      <PageHeader title={`${client.name} · Experiments`} subtitle="A test is predeclared before it runs: hypothesis, treatment, control, one primary metric, a stop rule and a readout date. Once running, the design is frozen; results are read on the readout date, not before." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card title={`Register · ${d.experiments.length}`}>
          {d.experiments.length === 0 ? <Empty>No experiments yet. Promote a finding with a measurable next readout, then propose a test here.</Empty> : null}
          <ul className="divide-y divide-neutral-100">
            {d.experiments.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.name}</span>
                  <Chip value={e.status} />
                  {e.predeclaredAt ? <span className="mono text-[11px] text-emerald-700">predeclared {fmtDate(e.predeclaredAt)}</span> : null}
                  {e.readoutOn ? <span className="mono text-[11px] text-fg-muted">readout {fmtDate(e.readoutOn)}</span> : null}
                </div>
                <p className="mt-1 text-sm text-fg-2"><span className="label mr-1">hypothesis</span>{e.hypothesis}</p>
                <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-fg-2 md:grid-cols-2">
                  <p><span className="label mr-1">treatment</span>{e.treatment ?? "—"}</p>
                  <p><span className="label mr-1">control</span>{e.control ?? <span className="text-coral">missing</span>}</p>
                  <p><span className="label mr-1">metric</span>{e.metricName ?? <span className="text-coral">missing</span>}{e.minSample ? ` · n ≥ ${e.minSample}` : ""}</p>
                  <p><span className="label mr-1">stop rule</span>{e.stopRule ?? "—"}</p>
                  {e.findingTitle ? <p className="md:col-span-2"><span className="label mr-1">from finding</span>{e.findingTitle}</p> : null}
                  <p className="md:col-span-2"><span className="label mr-1">owner</span>{e.owner ?? "—"}{e.approvedBy ? ` · approved by ${e.approvedBy}` : ""}</p>
                </div>
                {e.conclusion ? <p className="mt-1 rounded-md bg-bg-3 p-2 text-sm"><span className="label mr-1">conclusion</span>{e.conclusion}{e.result?.note ? <span className="text-fg-muted"> · {e.result.note}</span> : null}</p> : null}
                {canEdit ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {e.status === "proposed" ? <ActionButton action={setExperimentStatus.bind(null, slug, e.id, "approved")} className={btnSecondary}>Approve design</ActionButton> : null}
                    {e.status === "approved" ? <ActionButton action={setExperimentStatus.bind(null, slug, e.id, "running")} className={btnPrimary}>Start (predeclares)</ActionButton> : null}
                    {e.status === "running" ? <ActionButton action={setExperimentStatus.bind(null, slug, e.id, "readout")} className={btnSecondary}>Move to readout</ActionButton> : null}
                    {e.status === "readout" ? (
                      <ActionForm action={setExperimentStatus.bind(null, slug, e.id, "concluded")} className="flex flex-wrap gap-1">
                        <input name="conclusion" placeholder="Conclusion" className={`${input} w-64`} required />
                        <input name="result" placeholder="Result figures" className={`${input} w-48`} />
                        <button className={btnPrimary}>Conclude</button>
                      </ActionForm>
                    ) : null}
                    {["proposed", "approved", "running"].includes(e.status) ? <ActionButton action={setExperimentStatus.bind(null, slug, e.id, "abandoned")} className="text-xs underline">abandon</ActionButton> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <div>
          {canEdit ? (
            <Card title="Propose an experiment">
              <ActionForm action={proposeExperiment.bind(null, slug, client.id)} className="space-y-2">
                <input name="name" placeholder="Name" className={input} required />
                <textarea name="hypothesis" placeholder="Hypothesis (if we do X for Y, Z changes because…)" className={input} rows={2} required />
                <input name="treatment" placeholder="Treatment" className={input} />
                <input name="control" placeholder="Control (holdout, prior period, matched cohort)" className={input} />
                <select name="primary_metric" className={input}><option value="">Primary metric…</option>{d.metrics.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
                <div className="grid grid-cols-2 gap-2">
                  <input name="min_sample" type="number" placeholder="Min sample" className={input} />
                  <input name="stop_rule" placeholder="Stop rule" className={input} />
                  <input name="starts_on" type="date" className={input} />
                  <input name="readout_on" type="date" className={input} />
                </div>
                <select name="finding_id" className={input}><option value="">From a finding (optional)…</option>{d.findings.map((f) => <option key={f.id} value={f.id}>{f.title.slice(0, 70)}</option>)}</select>
                <button className={btnPrimary}>Propose</button>
              </ActionForm>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
