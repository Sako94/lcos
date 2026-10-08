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
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.facts (client_id, category, statement, source_id, source_quote, proposed_by)
      values (${clientId}, ${category}::app.fact_category, ${statement}, ${sourceId}, ${quote}, ${user.id})`);
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
