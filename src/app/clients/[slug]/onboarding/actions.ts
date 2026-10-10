"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { FACT_CATEGORIES } from "@/lib/clients";
import { QUESTIONNAIRE_VERSION, answerText, type AnswerValue } from "@/lib/onboarding/questions";

export type ActionResult = { ok: true } | { ok: false; error: string };

function msg(e: unknown) {
  return e instanceof Error ? e.message.replace(/^.*?ERROR:\s*/, "") : String(e);
}

async function run(slug: string, fn: (userId: string) => Promise<unknown>, formId?: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await fn(user.id);
    revalidatePath(`/clients/${slug}/onboarding`);
    if (formId) revalidatePath(`/clients/${slug}/onboarding/${formId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function createLink(slug: string, formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get("client_id"));
  const name = String(formData.get("respondent_name") ?? "").trim() || null;
  const email = String(formData.get("respondent_email") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right" };
  return run(slug, (uid) =>
    withUser(uid, (tx) => tx`
      insert into public.onboarding_forms (client_id, questionnaire_version, respondent_name, respondent_email, note)
      values (${clientId}, ${QUESTIONNAIRE_VERSION}, ${name}, ${email}, ${note})`),
  );
}

export async function extendLink(slug: string, formId: string): Promise<ActionResult> {
  return run(slug, (uid) =>
    withUser(uid, (tx) => tx`update public.onboarding_forms set expires_at = greatest(expires_at, now()) + interval '30 days' where id = ${formId}`),
    formId);
}

export async function setLinkStatus(slug: string, formId: string, status: "revoked" | "in_progress" | "reviewed"): Promise<ActionResult> {
  return run(slug, (uid) =>
    withUser(uid, (tx) => tx`update public.onboarding_forms set status = ${status}::app.onboarding_status where id = ${formId}`),
    formId);
}

/** Turn a client answer into a Proposed fact citing the submitted questionnaire. */
export async function promoteAnswer(slug: string, formId: string, answerId: string, formData: FormData): Promise<ActionResult> {
  const statement = String(formData.get("statement") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  if (!statement) return { ok: false, error: "Write the fact statement" };
  if (!FACT_CATEGORIES.some((c) => c.key === category)) return { ok: false, error: "Pick a category" };
  return run(slug, (uid) =>
    withUser(uid, async (tx) => {
      const rows = await tx<{ clientId: string; value: AnswerValue; sourceId: string | null; reviewStatus: string }[]>`
        select a.client_id, a.value, f.source_id, a.review_status
        from public.onboarding_answers a join public.onboarding_forms f on f.id = a.form_id
        where a.id = ${answerId} and a.form_id = ${formId}`;
      const a = rows[0];
      if (!a) throw new Error("Answer not found");
      if (a.reviewStatus !== "pending") throw new Error("This answer has already been reviewed");
      const quote = answerText(a.value).slice(0, 1000);
      const [fact] = await tx<{ id: string }[]>`
        insert into public.facts (client_id, category, statement, source_id, source_quote, proposed_by, evidence_class)
        values (${a.clientId}, ${category}::app.fact_category, ${statement}, ${a.sourceId}, ${quote}, ${uid}, 'stated')
        returning id`;
      await tx`update public.onboarding_answers set review_status = 'promoted', fact_id = ${fact.id} where id = ${answerId}`;
    }),
    formId);
}

export async function skipAnswer(slug: string, formId: string, answerId: string, formData: FormData): Promise<ActionResult> {
  const note = String(formData.get("review_note") ?? "").trim() || null;
  return run(slug, (uid) =>
    withUser(uid, (tx) => tx`
      update public.onboarding_answers set review_status = 'skipped', review_note = ${note}
      where id = ${answerId} and form_id = ${formId} and review_status = 'pending'`),
    formId);
}

export async function skipRemaining(slug: string, formId: string): Promise<ActionResult> {
  return run(slug, (uid) =>
    withUser(uid, (tx) => tx`
      update public.onboarding_answers set review_status = 'skipped', review_note = 'skipped in bulk'
      where form_id = ${formId} and review_status = 'pending'`),
    formId);
}

export async function unskipAnswer(slug: string, formId: string, answerId: string): Promise<ActionResult> {
  return run(slug, (uid) =>
    withUser(uid, (tx) => tx`
      update public.onboarding_answers set review_status = 'pending', review_note = null
      where id = ${answerId} and form_id = ${formId} and review_status = 'skipped'`),
    formId);
}
