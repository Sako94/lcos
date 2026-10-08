import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { addCommitment, addDecision, draftPreread, setCommitmentStatus, teamForClient, updateMeeting } from "../actions";

export const maxDuration = 300;

export default async function MeetingPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const meeting = (await tx<{ id: string; scheduledAt: string; preRead: string | null; agenda: string | null; transcriptUrl: string | null; status: string }[]>`
      select id, scheduled_at, pre_read, agenda, transcript_url, status from public.meetings where id = ${id} and client_id = ${client.id}`)[0];
    if (!meeting) return null;
    const decisions = await tx<{ id: string; statement: string; decidedBy: string | null; recordedBy: string | null; factStatement: string | null; createdAt: string }[]>`
      select d.id, d.statement, d.decided_by, p.full_name as recorded_by, f.statement as fact_statement, d.created_at
      from public.decisions d left join public.profiles p on p.id = d.recorded_by left join public.facts f on f.id = d.changes_fact_id where d.meeting_id = ${id} order by d.created_at`;
    const commitments = await tx<{ id: string; statement: string; owner: string; dueOn: string; status: string; clickupTaskId: string | null }[]>`
      select c.id, c.statement, p.full_name as owner, c.due_on, c.status, t.clickup_task_id from public.commitments c join public.profiles p on p.id = c.owner_id
      left join public.tasks t on t.id = c.task_id where c.meeting_id = ${id} order by c.due_on`;
    const prior = await tx<{ id: string; statement: string; owner: string; dueOn: string; status: string }[]>`
      select c.id, c.statement, p.full_name as owner, c.due_on, c.status from public.commitments c join public.profiles p on p.id = c.owner_id
      where c.client_id = ${client.id} and c.status = 'open' and (c.meeting_id is null or c.meeting_id <> ${id}) order by c.due_on`;
    const facts = await tx<{ id: string; statement: string }[]>`select id, statement from public.facts where client_id = ${client.id} and status = 'approved' order by category`;
    return { role, meeting, decisions, commitments, prior, facts };
  });
  if (!d) notFound();
  const team = await teamForClient(client.id);
  const canEdit = d.role === "admin" || d.role === "account_lead";
  const m = d.meeting;

  return (
    <>
      <PageHeader
        title={`Meeting · ${new Date(m.scheduledAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`}
        subtitle={<>{client.name} · <Chip value={m.status} /></>}
        actions={canEdit ? (
          <>
            <ActionButton action={draftPreread.bind(null, slug, client.id, m.id)} className={btnSecondary}>Agent: draft pre-read</ActionButton>
            {m.status === "planned" ? <ActionForm action={updateMeeting.bind(null, slug, m.id)}><input type="hidden" name="status" value="pre_read_sent" /><button className={btnSecondary}>Mark pre-read sent</button></ActionForm> : null}
            {m.status === "pre_read_sent" ? <ActionForm action={updateMeeting.bind(null, slug, m.id)}><input type="hidden" name="status" value="held" /><button className={btnSecondary}>Mark held</button></ActionForm> : null}
            {m.status === "held" ? <ActionForm action={updateMeeting.bind(null, slug, m.id)}><input type="hidden" name="status" value="closed" /><button className={btnPrimary}>Close meeting</button></ActionForm> : null}
          </>
        ) : null}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Pre-read">
            {canEdit ? (
              <ActionForm action={updateMeeting.bind(null, slug, m.id)} resetOnSuccess={false}>
                <textarea name="pre_read" defaultValue={m.preRead ?? ""} rows={18} className={input + " font-mono text-xs"} placeholder="Scorecard, completed work, open decisions, prior commitments, next cycle, decisions needed" />
                <input name="agenda" defaultValue={m.agenda ?? ""} placeholder="Agenda" className={input + " mt-2"} />
                <input name="transcript_url" defaultValue={m.transcriptUrl ?? ""} placeholder="Fireflies transcript link" className={input + " mt-2"} />
                <button className={btnSecondary + " mt-2"}>Save</button>
              </ActionForm>
            ) : (
              <pre className="whitespace-pre-wrap text-sm">{m.preRead ?? "No pre-read."}</pre>
            )}
          </Card>
          <Card title="Decisions">
            {d.decisions.length === 0 ? <Empty>No decisions recorded.</Empty> : (
              <ul className="space-y-2 text-sm">
                {d.decisions.map((x) => (
                  <li key={x.id}>
                    {x.statement}
                    <span className="block text-xs text-neutral-500">by {x.decidedBy ?? "—"} · recorded by {x.recordedBy} · {fmtDate(x.createdAt)}{x.factStatement ? ` · changes fact: ${x.factStatement.slice(0, 60)}… (triggers SOP 2)` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <ActionForm action={addDecision.bind(null, slug, m.id)} className="mt-3 grid gap-2 md:grid-cols-3">
                <input type="hidden" name="client_id" value={client.id} />
                <input name="statement" placeholder="Decision" className={input + " md:col-span-2"} required />
                <input name="decided_by" placeholder="Decided by (e.g. Artemi)" className={input} />
                <select name="changes_fact_id" className={input + " md:col-span-2"}>
                  <option value="">Does not change an approved fact</option>
                  {d.facts.map((f) => <option key={f.id} value={f.id}>Changes: {f.statement.slice(0, 80)}</option>)}
                </select>
                <button className={btnSecondary}>Record decision</button>
              </ActionForm>
            ) : null}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Commitments from this meeting">
            {d.commitments.length === 0 ? <Empty>None yet.</Empty> : (
              <ul className="space-y-2 text-sm">
                {d.commitments.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2">
                    <span>{c.statement}<span className="block text-xs text-neutral-500">{c.owner} · due {fmtDate(c.dueOn)}{c.clickupTaskId ? <> · <a className="underline" href={`https://app.clickup.com/t/${c.clickupTaskId}`}>ClickUp</a></> : " · not mirrored"}</span></span>
                    <span className="flex flex-col items-end gap-1">
                      <Chip value={c.status} />
                      {c.status === "open" ? (
                        <span className="flex gap-2">
                          <ActionButton action={setCommitmentStatus.bind(null, slug, m.id, c.id, "done")} className="text-xs underline">done</ActionButton>
                          <ActionButton action={setCommitmentStatus.bind(null, slug, m.id, c.id, "dropped")} className="text-xs text-neutral-500 underline">drop</ActionButton>
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <ActionForm action={addCommitment.bind(null, slug, m.id)} className="mt-3 space-y-2">
                <input type="hidden" name="client_id" value={client.id} />
                <input name="statement" placeholder="Commitment" className={input} required />
                <div className="flex gap-2">
                  <select name="owner_id" className={input} required>
                    <option value="">Owner (required)</option>
                    {team.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
                  </select>
                  <input type="date" name="due_on" className={input} required />
                </div>
                <button className={btnPrimary}>Add commitment (mirrors to ClickUp)</button>
              </ActionForm>
            ) : null}
          </Card>
          <Card title="Prior commitments still open">
            {d.prior.length === 0 ? <Empty>Nothing carried over.</Empty> : (
              <ul className="space-y-1 text-sm">
                {d.prior.map((c) => <li key={c.id}>{c.statement} <span className="text-xs text-neutral-500">{c.owner} · due {fmtDate(c.dueOn)}</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
