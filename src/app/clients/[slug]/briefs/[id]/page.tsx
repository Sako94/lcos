import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { QA_ITEMS, clientRole, getClient } from "@/lib/clients";
import { AgentTag, Card, Chip, Empty, PageHeader, btnPrimary, btnSecondary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { addCopyVersion, draftBrief, saveQa, setBriefStatus, updateBrief } from "../../calendar/actions";

type Brief = {
  id: string; title: string; goal: string | null; segment: string | null; offerFactId: string | null; keyMessage: string | null; proof: string | null; cta: string | null;
  designNotes: string | null; designUrl: string | null; status: string; currentCopyVersion: number; qaChecklist: { item: string; passed: boolean }[];
  internalApprovedVersion: number | null; internalApprovedBy: string | null; internalApprovedAt: string | null; clientApprovalEvidenceUrl: string | null; clientApprovedAt: string | null;
  owner: string | null; sendOn: string | null; channel: string | null;
};
type Copy = { id: string; version: number; subjectLines: string[]; previewText: string | null; body: string | null; smsBody: string | null; factIds: string[]; createdByKind: string; createdBy: string | null; agentRunId: string | null; createdAt: string };

export const maxDuration = 300;

export default async function BriefPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const brief = (await tx<Brief[]>`
      select b.id, b.title, b.goal, b.segment, b.offer_fact_id, b.key_message, b.proof, b.cta, b.design_notes, b.design_url, b.status, b.current_copy_version, b.qa_checklist,
             b.internal_approved_version, pa.full_name as internal_approved_by, b.internal_approved_at, b.client_approval_evidence_url, b.client_approved_at,
             po.full_name as owner, s.send_on, s.channel
      from public.briefs b left join public.profiles pa on pa.id = b.internal_approved_by left join public.profiles po on po.id = b.owner_id
      left join public.calendar_slots s on s.id = b.slot_id where b.id = ${id} and b.client_id = ${client.id}`)[0];
    if (!brief) return null;
    const copies = await tx<Copy[]>`
      select c.id, c.version, c.subject_lines, c.preview_text, c.body, c.sms_body, c.fact_ids, c.created_by_kind, p.full_name as created_by, c.agent_run_id, c.created_at
      from public.copy_versions c left join public.profiles p on p.id = c.created_by where c.brief_id = ${id} order by c.version desc`;
    const approvedFacts = await tx<{ id: string; category: string; statement: string }[]>`select id, category, statement from public.facts where client_id = ${client.id} and status = 'approved' order by category`;
    const offers = approvedFacts.filter((f) => f.category === "offers_discounts");
    return { role, brief, copies, approvedFacts, offers };
  });
  if (!d) notFound();
  const { brief, copies } = d;
  const canEdit = d.role === "admin" || d.role === "account_lead";
  const isAdmin = d.role === "admin";
  const qa = QA_ITEMS.map((item) => ({ item, passed: brief.qaChecklist.find((q) => q.item === item)?.passed ?? false }));
  const approvedCopy = brief.internalApprovedVersion ? copies.find((c) => c.version === brief.internalApprovedVersion) : null;
  const facts = new Map(d.approvedFacts.map((f) => [f.id, f]));

  return (
    <>
      <PageHeader
        title={brief.title}
        subtitle={<>{client.name} · {brief.channel ? brief.channel.toUpperCase() : "no slot"}{brief.sendOn ? ` · ${fmtDate(brief.sendOn)}` : ""} · owner {brief.owner ?? "—"} · <Chip value={brief.status} />{approvedCopy ? <> · approved copy v{approvedCopy.version} by {brief.internalApprovedBy} on {fmtDate(brief.internalApprovedAt)}</> : null}</>}
        actions={
          canEdit ? (
            <>
              <ActionButton action={draftBrief.bind(null, slug, client.id, brief.id)} className={btnSecondary}>Agent: draft brief + copy</ActionButton>
              {brief.status === "draft" ? <ActionButton action={setBriefStatus.bind(null, slug, brief.id, "copy_review")} className={btnSecondary}>Request copy review</ActionButton> : null}
              {brief.status === "copy_review" ? <ActionButton action={setBriefStatus.bind(null, slug, brief.id, "qa")} className={btnSecondary}>Send to QA</ActionButton> : null}
              {brief.status === "qa" && isAdmin ? <ActionButton action={setBriefStatus.bind(null, slug, brief.id, "internal_approved")} className={btnPrimary}>Approve v{brief.currentCopyVersion} (admin)</ActionButton> : null}
            </>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Brief">
            {canEdit ? (
              <ActionForm action={updateBrief.bind(null, slug, brief.id)} className="grid gap-2 md:grid-cols-2" resetOnSuccess={false}>
                <label className="text-xs text-neutral-500 md:col-span-2">Goal<textarea name="goal" defaultValue={brief.goal ?? ""} className={input} rows={2} /></label>
                <label className="text-xs text-neutral-500">Segment<input name="segment" defaultValue={brief.segment ?? ""} className={input} /></label>
                <label className="text-xs text-neutral-500">Offer (approved facts only)
                  <select name="offer_fact_id" defaultValue={brief.offerFactId ?? ""} className={input}>
                    <option value="">No offer</option>
                    {d.offers.map((o) => <option key={o.id} value={o.id}>{o.statement.slice(0, 90)}</option>)}
                  </select>
                </label>
                <label className="text-xs text-neutral-500 md:col-span-2">Key message<textarea name="key_message" defaultValue={brief.keyMessage ?? ""} className={input} rows={2} /></label>
                <label className="text-xs text-neutral-500 md:col-span-2">Proof<textarea name="proof" defaultValue={brief.proof ?? ""} className={input} rows={2} /></label>
                <label className="text-xs text-neutral-500">CTA<input name="cta" defaultValue={brief.cta ?? ""} className={input} /></label>
                <label className="text-xs text-neutral-500">Design link<input name="design_url" defaultValue={brief.designUrl ?? ""} className={input} /></label>
                <label className="text-xs text-neutral-500 md:col-span-2">Design notes<textarea name="design_notes" defaultValue={brief.designNotes ?? ""} className={input} rows={2} /></label>
                <div className="md:col-span-2"><button className={btnSecondary}>Save brief</button> <span className="text-xs text-neutral-500">Editing content after approval returns the brief to Draft.</span></div>
              </ActionForm>
            ) : (
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                {[["Goal", brief.goal], ["Segment", brief.segment], ["Key message", brief.keyMessage], ["Proof", brief.proof], ["CTA", brief.cta], ["Design notes", brief.designNotes]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-xs text-neutral-500">{k}</dt><dd>{v ?? "—"}</dd></div>
                ))}
                <ActionForm action={updateBrief.bind(null, slug, brief.id)} className="md:col-span-2 flex gap-2" resetOnSuccess={false}>
                  <input name="design_url" defaultValue={brief.designUrl ?? ""} placeholder="Figma link" className={input} />
                  <button className={btnSecondary}>Save design link</button>
                </ActionForm>
              </dl>
            )}
          </Card>

          <Card title={`Copy versions (${copies.length})`}>
            {copies.length === 0 ? <Empty>No copy yet. Ask the agent to draft, or add a version.</Empty> : null}
            <div className="space-y-4">
              {copies.map((c) => (
                <div key={c.id} className={`rounded-lg border p-3 ${c.version === brief.internalApprovedVersion ? "border-lime/50 bg-lime/5" : "border-neutral-200"}`}>
                  <p className="text-xs text-neutral-500">
                    v{c.version} · {c.createdByKind === "agent" ? <AgentTag runId={c.agentRunId} /> : c.createdBy} · {fmtDate(c.createdAt)}
                    {c.version === brief.internalApprovedVersion ? <span className="ml-2 text-emerald-800">approved version</span> : null}
                  </p>
                  {c.subjectLines.length ? <p className="mt-1 text-sm"><span className="font-medium">Subjects:</span> {c.subjectLines.join(" / ")}</p> : null}
                  {c.previewText ? <p className="text-sm"><span className="font-medium">Preview:</span> {c.previewText}</p> : null}
                  {c.body ? <pre className="mt-2 whitespace-pre-wrap rounded bg-bg-3 p-2 text-sm">{c.body}</pre> : null}
                  {c.smsBody ? <p className="mt-2 text-sm"><span className="font-medium">SMS:</span> {c.smsBody}</p> : null}
                  <p className="mt-2 text-xs text-neutral-500">
                    Facts cited: {c.factIds.length === 0 ? "none" : c.factIds.map((fid) => facts.get(fid)?.statement.slice(0, 50) ?? "(no longer approved)").join(" · ")}
                  </p>
                </div>
              ))}
            </div>
            {canEdit ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs underline">Add a copy version (immutable once saved)</summary>
                <ActionForm action={addCopyVersion.bind(null, slug, brief.id)} className="mt-2 space-y-2">
                  <textarea name="subject_lines" placeholder="Subject lines, one per line" className={input} rows={3} />
                  <input name="preview_text" placeholder="Preview text" className={input} />
                  <textarea name="body" placeholder="Body copy" className={input} rows={8} />
                  <input name="sms_body" placeholder="SMS variant (optional)" className={input} />
                  <p className="text-xs text-neutral-500">Approved facts this copy relies on:</p>
                  <div className="max-h-40 space-y-1 overflow-auto rounded border border-neutral-200 p-2 text-xs">
                    {d.approvedFacts.map((f) => (
                      <label key={f.id} className="flex gap-2"><input type="checkbox" name="fact_ids" value={f.id} /> <span>{f.statement}</span></label>
                    ))}
                    {d.approvedFacts.length === 0 ? <span className="text-amber-700">No approved facts yet.</span> : null}
                  </div>
                  <button className={btnPrimary}>Save version</button>
                </ActionForm>
              </details>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="QA checklist (SOP 8)">
            <ActionForm action={saveQa.bind(null, slug, brief.id, QA_ITEMS)} className="space-y-1" resetOnSuccess={false}>
              {qa.map((q, i) => (
                <label key={q.item} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`qa_${i}`} defaultChecked={q.passed} disabled={!canEdit} /> {q.item}
                </label>
              ))}
              {canEdit ? <button className={btnSecondary + " mt-2"}>Save checklist</button> : null}
            </ActionForm>
            <p className="mt-2 text-xs text-neutral-500">{qa.filter((q) => q.passed).length}/{qa.length} passed. Any unchecked item blocks internal approval.</p>
          </Card>
          <Card title="Client approval (Figma + Slack)">
            {brief.clientApprovedAt ? (
              <p className="text-sm text-emerald-800">Client approved {fmtDate(brief.clientApprovedAt)} · <a className="underline" href={brief.clientApprovalEvidenceUrl ?? "#"}>evidence</a></p>
            ) : brief.status === "internal_approved" && canEdit ? (
              <ActionForm action={setBriefStatus.bind(null, slug, brief.id, "client_approved")} className="space-y-2">
                <input name="client_approval_evidence_url" placeholder="Slack permalink or Figma comment link" className={input} required />
                <button className={btnPrimary}>Record client approval</button>
                <p className="text-xs text-neutral-500">Client silence is not approval. Paste the link where the client said yes.</p>
              </ActionForm>
            ) : (
              <p className="text-sm text-neutral-500">Available after internal approval.</p>
            )}
          </Card>
          <Card title="Status rules">
            <ul className="space-y-1 text-xs text-neutral-600">
              <li>Agent can draft and move to copy review; nothing further.</li>
              <li>Internal approval: admin only, on the current copy version, with every QA item passed.</li>
              <li>Client approval requires internal approval and an evidence link.</li>
              <li>Any content edit after approval returns to Draft and clears the approval.</li>
              <li>Scheduling and sending happen in Klaviyo in the MVP; record the outcome here.</li>
            </ul>
            {canEdit && (brief.status === "client_approved" || brief.status === "scheduled") ? (
              <div className="mt-2 flex gap-2">
                {brief.status === "client_approved" ? <ActionButton action={setBriefStatus.bind(null, slug, brief.id, "scheduled")} className={btnSecondary}>Mark scheduled</ActionButton> : null}
                {brief.status === "scheduled" ? <ActionButton action={setBriefStatus.bind(null, slug, brief.id, "sent")} className={btnSecondary}>Mark sent</ActionButton> : null}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
