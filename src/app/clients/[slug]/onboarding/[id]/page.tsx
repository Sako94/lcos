import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { FACT_CATEGORIES, clientRole, getClient } from "@/lib/clients";
import { QUESTION_BY_KEY, SECTIONS, answerText, defaultStatement, type AnswerValue } from "@/lib/onboarding/questions";
import { linkBase } from "@/lib/onboarding/url";
import { Card, Chip, PageHeader, btnPrimary, btnSecondary, fmtDate, input } from "@/components/ui";
import { ActionButton, ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { promoteAnswer, setLinkStatus, skipAnswer, skipRemaining, unskipAnswer } from "../actions";

type Form = {
  id: string; token: string; status: string; respondentName: string | null; respondentEmail: string | null; expiresAt: Date;
  submittedAt: Date | null; submittedByName: string | null; sourceId: string | null; reviewedBy: string | null; reviewedAt: Date | null;
};
type Answer = {
  id: string; questionKey: string; value: AnswerValue; reviewStatus: "pending" | "promoted" | "skipped"; reviewNote: string | null;
  factId: string | null; factStatus: string | null; factStatement: string | null; reviewedBy: string | null;
};

export default async function OnboardingReviewPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const forms = await tx<Form[]>`
      select f.id, f.token, f.status, f.respondent_name, f.respondent_email, f.expires_at, f.submitted_at, f.submitted_by_name, f.source_id,
             p.full_name as reviewed_by, f.reviewed_at
      from public.onboarding_forms f left join public.profiles p on p.id = f.reviewed_by
      where f.id = ${id} and f.client_id = ${client.id}`;
    const answers = await tx<Answer[]>`
      select a.id, a.question_key, a.value, a.review_status, a.review_note, a.fact_id, fa.status as fact_status, fa.statement as fact_statement,
             p.full_name as reviewed_by
      from public.onboarding_answers a left join public.facts fa on fa.id = a.fact_id left join public.profiles p on p.id = a.reviewed_by
      where a.form_id = ${id}`;
    return { role, form: forms[0], answers };
  });
  if (!d.form) notFound();
  const f = d.form;
  const canReview = d.role === "admin" || d.role === "account_lead";
  const reviewing = f.status === "submitted";
  const byKey = new Map(d.answers.map((a) => [a.questionKey, a]));
  const pending = d.answers.filter((a) => a.reviewStatus === "pending").length;
  const promoted = d.answers.filter((a) => a.reviewStatus === "promoted").length;
  const url = `${await linkBase()}/onboard/${f.token}`;

  return (
    <>
      <PageHeader
        title={`${client.name} · Onboarding from ${f.submittedByName ?? f.respondentName ?? "client"}`}
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <Chip value={f.status} label={f.status.replace("_", " ")} />
            {f.submittedAt ? <span>Submitted {fmtDate(f.submittedAt)}</span> : <span>Not submitted yet · link expires {fmtDate(f.expiresAt)}</span>}
            {f.reviewedAt ? <span>· reviewed by {f.reviewedBy} on {fmtDate(f.reviewedAt)}</span> : null}
            <span>· {d.answers.length} answers · {promoted} promoted · {pending} to review</span>
          </div>
        }
        actions={
          <>
            <Link href={`/clients/${slug}/onboarding`} className={btnSecondary}>All links</Link>
            {canReview && f.status === "submitted" ? (
              <ActionButton action={setLinkStatus.bind(null, slug, f.id, "in_progress")} className={btnSecondary} confirm="Reopen the form so the client can change answers? Changed answers return to the review queue.">
                Reopen for client
              </ActionButton>
            ) : null}
            {canReview && reviewing ? (
              <ActionButton action={setLinkStatus.bind(null, slug, f.id, "reviewed")} className={btnPrimary}>
                Mark reviewed
              </ActionButton>
            ) : null}
          </>
        }
      />
      {f.status === "sent" || f.status === "in_progress" ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-bg-2 p-4 text-sm">
          <span className="label">Client link</span>
          <input readOnly value={url} aria-label="Client link" className="min-w-0 flex-1 rounded-lg border border-line bg-bg-3 px-3 py-1.5 font-mono text-xs text-fg-2" />
          <CopyButton text={url} className="text-xs underline" />
        </div>
      ) : null}
      {!reviewing && f.status !== "reviewed" ? (
        <p className="mb-6 rounded-lg border border-dashed border-line p-4 text-sm text-fg-muted">
          The client hasn&apos;t submitted yet. You can read answers as they come in; review opens once they submit.
        </p>
      ) : null}
      {canReview && reviewing && pending > 0 ? (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-line bg-bg-2 p-4 text-sm">
          <span>Promote the answers worth keeping, then skip the rest. The questionnaire can be marked reviewed when nothing is pending.</span>
          <ActionButton action={skipRemaining.bind(null, slug, f.id)} className="shrink-0 text-xs underline" confirm={`Skip all ${pending} remaining answers?`}>
            skip all remaining
          </ActionButton>
        </div>
      ) : null}
      <div className="space-y-6">
        {SECTIONS.map((s) => (
          <Card key={s.key} title={s.title}>
            <ul className="divide-y divide-line-soft">
              {s.questions.map((q) => {
                const a = byKey.get(q.key);
                const cat = FACT_CATEGORIES.find((c) => c.key === q.category);
                return (
                  <li key={q.key} className="py-3" data-question={q.key}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-fg-muted">{q.label}</p>
                        {a ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm">{answerText(a.value)}</p>
                        ) : (
                          <p className="mt-1 text-sm text-fg-muted">— no answer</p>
                        )}
                        {a?.reviewStatus === "promoted" && a.factId ? (
                          <p className="mt-2 text-xs text-fg-muted">
                            → <Link href={`/clients/${slug}/facts`} className="underline">{a.factStatement}</Link>{" "}
                            {a.factStatus ? <Chip value={a.factStatus} /> : null}
                          </p>
                        ) : null}
                        {a?.reviewStatus === "skipped" ? (
                          <p className="mt-2 text-xs text-fg-muted">Skipped{a.reviewedBy ? ` by ${a.reviewedBy}` : ""}{a.reviewNote ? ` — ${a.reviewNote}` : ""}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {a ? <Chip value={a.reviewStatus === "pending" ? "pending" : a.reviewStatus === "promoted" ? "promoted" : "dismissed"} label={a.reviewStatus} /> : null}
                        {canReview && reviewing && a?.reviewStatus === "skipped" ? (
                          <ActionButton action={unskipAnswer.bind(null, slug, f.id, a.id)} className="text-xs underline">undo</ActionButton>
                        ) : null}
                      </div>
                    </div>
                    {canReview && reviewing && a?.reviewStatus === "pending" ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-line-soft bg-bg p-3 md:grid-cols-[1fr_auto]">
                        <ActionForm action={promoteAnswer.bind(null, slug, f.id, a.id)} className="space-y-2" resetOnSuccess={false}>
                          <textarea name="statement" defaultValue={defaultStatement(QUESTION_BY_KEY.get(q.key)!, a.value)} rows={2} className={input} aria-label="Fact statement" />
                          <div className="flex flex-wrap items-center gap-2">
                            <select name="category" defaultValue={q.category} className="rounded-lg border border-line bg-bg-3 px-2 py-1.5 text-xs" aria-label="Category">
                              {FACT_CATEGORIES.map((c) => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                            <button className={btnPrimary}>Promote to Source of Truth</button>
                            {cat?.sensitive ? <span className="text-xs text-amber-700">admin approves this category</span> : null}
                          </div>
                        </ActionForm>
                        <ActionForm action={skipAnswer.bind(null, slug, f.id, a.id)} className="flex items-start gap-2 md:flex-col md:items-end">
                          <input name="review_note" placeholder="Why skip? (optional)" className="rounded-lg border border-line bg-bg-3 px-2 py-1.5 text-xs" />
                          <button className={btnSecondary}>Skip</button>
                        </ActionForm>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
