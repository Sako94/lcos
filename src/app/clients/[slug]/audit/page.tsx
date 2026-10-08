import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { AgentTag, Card, Chip, Empty, PageHeader, Table, btnPrimary, btnSecondary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { addFinding, createAudit, runHealthReview, scoreArea, setAuditStatus, setFindingStatus } from "./actions";

type Area = { key: string; name: string; weight: number; checks: string; source: string; score1: string; score5: string };
type Score = { score?: number; reason?: string; evidence_url?: string; set_by_kind?: string; verified?: boolean };
type Finding = {
  id: string; area: string; title: string; detail: string | null; evidenceUrl: string | null; severity: number; confidence: string;
  impact: number | null; effort: number | null; status: string; nextAction: string | null; createdByKind: string; agentRunId: string | null; createdAt: string; dismissReason: string | null;
};

export default async function AuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const audits = await tx<{ id: string; kind: string; periodStart: string; periodEnd: string; status: string; scores: Record<string, Score>; overall: string | null; templateVersion: number; agentRunId: string | null }[]>`
      select id, kind, period_start, period_end, status, scores, overall, template_version, agent_run_id from public.audits where client_id = ${client.id} order by created_at desc limit 6`;
    const latest = audits[0];
    const template = latest
      ? (await tx<{ areas: Area[] }[]>`select areas from public.audit_templates where version = ${latest.templateVersion}`)[0]?.areas ?? []
      : [];
    const findings = await tx<Finding[]>`
      select id, area, title, detail, evidence_url, severity, confidence, impact, effort, status, next_action, created_by_kind, agent_run_id, created_at, dismiss_reason
      from public.findings where client_id = ${client.id} order by case status when 'new' then 0 when 'confirmed' then 1 when 'promoted' then 2 else 3 end, severity, created_at desc`;
    const lastRun = (await tx<{ id: string; status: string; finishedAt: string | null; error: string | null }[]>`
      select id, status, finished_at, error from public.agent_runs where client_id = ${client.id} and job_type = 'health_review' order by created_at desc limit 1`)[0];
    return { role, audits, latest, template, findings, lastRun };
  });
  const canReview = d.role === "admin" || d.role === "account_lead";

  return (
    <>
      <PageHeader
        title={`${client.name} · Audit and health`}
        subtitle={
          d.lastRun ? (
            <>Last health review: <Chip value={d.lastRun.status} /> {d.lastRun.finishedAt ? fmtDate(d.lastRun.finishedAt) : ""} {d.lastRun.error ? <span className="text-red-700">{d.lastRun.error}</span> : null}</>
          ) : (
            "The health review has not run yet."
          )
        }
        actions={canReview ? <ActionButton action={runHealthReview.bind(null, slug, client.id)} className={btnPrimary}>Run health review now</ActionButton> : null}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title={d.latest ? <>Latest audit · {d.latest.kind.replace("_", " ")} · {fmtDate(d.latest.periodStart)} – {fmtDate(d.latest.periodEnd)} <Chip value={d.latest.status} /> {d.latest.agentRunId ? <AgentTag runId={d.latest.agentRunId} /> : null}</> : "Audit"}>
            {!d.latest ? (
              <Empty>No audit yet. Create one on the right.</Empty>
            ) : (
              <>
                <p className="mb-3 text-3xl font-semibold">{d.latest.overall ?? "—"}<span className="text-base text-neutral-500">/100 weighted</span></p>
                <Table head={["Area", "Weight", "Score", "Reason and evidence", ""]}>
                  {d.template.map((a) => {
                    const s = d.latest.scores[a.key];
                    return (
                      <tr key={a.key} className="align-top">
                        <td className="py-2 pr-4 font-medium">{a.name}<br /><span className="text-xs font-normal text-neutral-500">{a.checks}</span></td>
                        <td className="py-2 pr-4">{a.weight}</td>
                        <td className="py-2 pr-4">
                          {s?.score != null ? <span className="text-lg font-semibold">{s.score}</span> : <span className="text-amber-700">Unscored</span>}
                          {s && !s.verified ? <span className="block text-xs text-amber-700">proposed</span> : null}
                          {s?.set_by_kind === "agent" ? <AgentTag /> : null}
                        </td>
                        <td className="py-2 pr-4 text-neutral-700">
                          {s?.reason}
                          {s?.evidence_url ? <a className="block text-xs underline" href={s.evidence_url}>evidence</a> : null}
                        </td>
                        <td className="py-2">
                          {canReview && d.latest.status !== "published" ? (
                            <details>
                              <summary className="cursor-pointer text-xs underline">score</summary>
                              <ActionForm action={scoreArea.bind(null, slug, d.latest.id, a.key)} className="mt-2 w-56 space-y-1" resetOnSuccess={false}>
                                <select name="score" defaultValue={s?.score ?? 3} className={input}>
                                  {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                                <input name="reason" defaultValue={s?.reason ?? ""} placeholder="One-line reason" className={input} required />
                                <input name="evidence_url" defaultValue={s?.evidence_url ?? ""} placeholder="Evidence URL" className={input} required />
                                <p className="text-xs text-neutral-500">1: {a.score1}<br />5: {a.score5}</p>
                                <button className={btnSecondary}>Save score</button>
                              </ActionForm>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </Table>
                {canReview ? (
                  <div className="mt-4 flex gap-2">
                    {d.latest.status !== "reviewed" && d.latest.status !== "published" ? (
                      <ActionButton action={setAuditStatus.bind(null, slug, d.latest.id, "reviewed")} className={btnSecondary}>Mark reviewed</ActionButton>
                    ) : null}
                    {d.latest.status === "reviewed" && d.role === "admin" ? (
                      <ActionButton action={setAuditStatus.bind(null, slug, d.latest.id, "published")} className={btnPrimary}>Sign off (admin)</ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card title="Findings">
            {d.findings.length === 0 ? <Empty>No findings.</Empty> : null}
            <ul className="divide-y divide-neutral-100">
              {d.findings.map((f) => (
                <li key={f.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span className="mr-2 rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white">S{f.severity}</span>
                        {f.title}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {f.area} · confidence {f.confidence}{f.impact ? ` · impact ${f.impact}` : ""}{f.effort ? ` · effort ${f.effort}` : ""} · {fmtDate(f.createdAt)} ·{" "}
                        {f.createdByKind === "agent" ? <AgentTag runId={f.agentRunId} /> : "team"}
                      </p>
                      {f.detail ? <p className="mt-1 text-sm text-neutral-700">{f.detail}</p> : null}
                      {f.nextAction ? <p className="mt-1 text-sm"><span className="font-medium">Next:</span> {f.nextAction}</p> : null}
                      {f.evidenceUrl ? <a className="text-xs underline" href={f.evidenceUrl}>evidence</a> : <span className="text-xs text-amber-700">no evidence link</span>}
                      {f.dismissReason ? <p className="text-xs text-neutral-500">Dismissed: {f.dismissReason}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Chip value={f.status} />
                      {canReview && (f.status === "new" || f.status === "confirmed") ? (
                        <div className="flex flex-col items-end gap-1">
                          {f.status === "new" ? <ActionButton action={setFindingStatus.bind(null, slug, f.id, "confirmed")} className="text-xs underline">confirm</ActionButton> : null}
                          <ActionButton action={setFindingStatus.bind(null, slug, f.id, "promoted")} className="text-xs underline">promote to task</ActionButton>
                          <ActionForm action={setFindingStatus.bind(null, slug, f.id, "dismissed")} className="flex gap-1">
                            <input name="dismiss_reason" placeholder="reason" className="w-28 rounded border border-neutral-300 px-1 text-xs" required />
                            <button className="text-xs text-red-700 underline">dismiss</button>
                          </ActionForm>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {canReview ? (
            <Card title="New audit">
              <ActionForm action={createAudit.bind(null, slug)} className="space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <select name="kind" className={input}>
                  <option value="onboarding">Onboarding</option>
                  <option value="quarterly">Quarterly</option>
                </select>
                <div className="flex gap-2">
                  <input type="date" name="period_start" className={input} required />
                  <input type="date" name="period_end" className={input} required />
                </div>
                <button className={btnSecondary}>Create audit</button>
              </ActionForm>
            </Card>
          ) : null}
          {canReview ? (
            <Card title="Add a finding">
              <ActionForm action={addFinding.bind(null, slug)} className="space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <input type="hidden" name="audit_id" value={d.latest?.id ?? ""} />
                <select name="area" className={input}>
                  {d.template.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
                  {d.template.length === 0 ? <option value="general">General</option> : null}
                </select>
                <input name="title" placeholder="Finding" className={input} required />
                <textarea name="detail" placeholder="Detail" className={input} rows={2} />
                <input name="evidence_url" placeholder="Evidence URL" className={input} />
                <div className="grid grid-cols-2 gap-2">
                  <select name="severity" className={input}><option value="1">Severity 1 · this week</option><option value="2">Severity 2 · this cycle</option><option value="3">Severity 3 · backlog</option></select>
                  <select name="confidence" className={input}><option value="high">High confidence</option><option value="medium">Medium</option><option value="low">Low</option></select>
                  <input name="impact" type="number" min={1} max={5} placeholder="Impact 1-5" className={input} />
                  <input name="effort" type="number" min={1} max={5} placeholder="Effort 1-5" className={input} />
                </div>
                <input name="next_action" placeholder="Next action" className={input} />
                <button className={btnPrimary}>Add finding</button>
              </ActionForm>
            </Card>
          ) : null}
          <Card title="Audit history">
            <ul className="space-y-1 text-sm">
              {d.audits.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span>{a.kind.replace("_", " ")} · {fmtDate(a.periodEnd)} · {a.overall ?? "—"}</span>
                  <Chip value={a.status} />
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-neutral-500">
            Severity 1 findings on deliverability or consent go to the admin the same day (SOP 3).
          </p>
        </div>
      </div>
    </>
  );
}
