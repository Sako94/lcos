"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";

export type ActionResult = { ok: true } | { ok: false; error: string };

function msg(e: unknown) {
  return e instanceof Error ? e.message.replace(/^.*?ERROR:\s*/, "") : String(e);
}

export async function proposeFact(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(formData.get("client_id"));
  const category = String(formData.get("category"));
  const statement = String(formData.get("statement") ?? "").trim();
  const quote = String(formData.get("source_quote") ?? "").trim() || null;
  const sourceId = String(formData.get("source_id") ?? "") || null;
  if (!statement) return { ok: false, error: "Statement is required" };
  const evidenceClass = String(formData.get("evidence_class") ?? "stated");
  const metricKey = String(formData.get("metric_key") ?? "").trim();
  const basis = metricKey
    ? { metric_key: metricKey, value: Number(formData.get("metric_value")) || null, window_start: String(formData.get("window_start") ?? "") || null, window_end: String(formData.get("window_end") ?? "") || null,
        time_basis: String(formData.get("time_basis") ?? "") || null, population: String(formData.get("population") ?? "").trim() || null }
    : null;
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.facts (client_id, category, statement, source_id, source_quote, proposed_by, evidence_class, metric_basis)
      values (${clientId}, ${category}::app.fact_category, ${statement}, ${sourceId}, ${quote}, ${user.id}, ${evidenceClass}::app.evidence_class, ${basis ? tx.json(basis) : null})`);
    revalidatePath(`/clients/${slug}/facts`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setFactStatus(slug: string, factId: string, status: "verified" | "approved" | "stale" | "proposed"): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.facts set status = ${status}::app.fact_status where id = ${factId}`);
    revalidatePath(`/clients/${slug}/facts`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function editFact(slug: string, factId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const statement = String(formData.get("statement") ?? "").trim();
  const quote = String(formData.get("source_quote") ?? "").trim() || null;
  const reviewDue = String(formData.get("review_due") ?? "") || null;
  if (!statement) return { ok: false, error: "Statement is required" };
  try {
    await withUser(user.id, (tx) => tx`
      update public.facts set statement = ${statement}, source_quote = ${quote}, review_due = ${reviewDue}::date where id = ${factId}`);
    revalidatePath(`/clients/${slug}/facts`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function addSource(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(formData.get("client_id"));
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "link");
  if (!title) return { ok: false, error: "Title is required" };
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.sources (client_id, kind, title, url, captured_at, uploaded_by)
      values (${clientId}, ${kind}::app.source_kind, ${title}, ${url}, current_date, ${user.id})`);
    revalidatePath(`/clients/${slug}/facts`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Correction: the new fact replaces the old one; the old one is marked Stale with the note (0006 rule). */
export async function supersedeFact(slug: string, factId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const newId = String(formData.get("superseded_by") ?? "").trim();
  const note = String(formData.get("correction_note") ?? "").trim();
  try {
    await withUser(user.id, (tx) => tx`update public.facts set superseded_by = ${newId}, correction_note = ${note} where id = ${factId}`);
    revalidatePath(`/clients/${slug}/facts`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
