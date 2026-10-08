"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { runJob } from "@/lib/agent/runner";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createCycle(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.cycles (client_id, starts_on, ends_on, objective)
      values (${String(formData.get("client_id"))}, ${String(formData.get("starts_on"))}::date, ${String(formData.get("ends_on"))}::date, ${String(formData.get("objective") ?? "") || null})`);
    revalidatePath(`/clients/${slug}/calendar`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setCycleStatus(slug: string, cycleId: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.cycles set status = ${status}::app.cycle_status where id = ${cycleId}`);
    revalidatePath(`/clients/${slug}/calendar`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function addSlot(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, async (tx) => {
      const slot = await tx<{ id: string }[]>`
        insert into public.calendar_slots (client_id, cycle_id, send_on, channel, purpose, title, segment, offer_fact_id, notes)
        values (${String(formData.get("client_id"))}, ${String(formData.get("cycle_id"))}, ${String(formData.get("send_on"))}::date,
                ${String(formData.get("channel"))}::app.channel, ${String(formData.get("purpose"))}::app.slot_purpose, ${String(formData.get("title"))},
                ${String(formData.get("segment") ?? "") || null}, ${String(formData.get("offer_fact_id") ?? "") || null}, ${String(formData.get("notes") ?? "") || null})
        returning id`;
      await tx`insert into public.briefs (client_id, slot_id, title, segment, offer_fact_id, owner_id)
               values (${String(formData.get("client_id"))}, ${slot[0].id}, ${String(formData.get("title"))}, ${String(formData.get("segment") ?? "") || null}, ${String(formData.get("offer_fact_id") ?? "") || null}, ${user.id})`;
    });
    revalidatePath(`/clients/${slug}/calendar`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function updateBrief(slug: string, briefId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const f = (k: string) => (formData.has(k) ? String(formData.get(k)) || null : undefined);
  try {
    await withUser(user.id, async (tx) => {
      const fields = { goal: f("goal"), segment: f("segment"), key_message: f("key_message"), proof: f("proof"), cta: f("cta"), design_notes: f("design_notes"), design_url: f("design_url"), offer_fact_id: f("offer_fact_id"), title: f("title") };
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        await tx.unsafe(`update public.briefs set ${k} = $1 where id = $2`, [v, briefId]);
      }
    });
    revalidatePath(`/clients/${slug}/briefs/${briefId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function addCopyVersion(slug: string, briefId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const subjects = String(formData.get("subject_lines") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const factIds = formData.getAll("fact_ids").map(String);
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.copy_versions (brief_id, subject_lines, preview_text, body, sms_body, fact_ids, created_by)
      values (${briefId}, ${tx.json(subjects)}, ${String(formData.get("preview_text") ?? "") || null}, ${String(formData.get("body") ?? "") || null},
              ${String(formData.get("sms_body") ?? "") || null}, ${factIds}::uuid[], ${user.id})`);
    revalidatePath(`/clients/${slug}/briefs/${briefId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setBriefStatus(slug: string, briefId: string, status: string, formData?: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const evidence = formData ? String(formData.get("client_approval_evidence_url") ?? "") : "";
  try {
    await withUser(user.id, (tx) => tx`update public.briefs set status = ${status}::app.brief_status ${evidence ? tx`, client_approval_evidence_url = ${evidence}` : tx``} where id = ${briefId}`);
    revalidatePath(`/clients/${slug}/briefs/${briefId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function saveQa(slug: string, briefId: string, items: string[], formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const checklist = items.map((item, i) => ({ item, passed: formData.get(`qa_${i}`) === "on", checked_by: user.id, checked_at: new Date().toISOString() }));
  try {
    await withUser(user.id, (tx) => tx`update public.briefs set qa_checklist = ${tx.json(checklist)} where id = ${briefId}`);
    revalidatePath(`/clients/${slug}/briefs/${briefId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function draftBrief(slug: string, clientId: string, briefId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "contributor") return { ok: false, error: "Contributors cannot run agent jobs" };
  const r = await runJob({ clientId, jobType: "brief_draft", requestedBy: user.id, inputs: { briefId } });
  revalidatePath(`/clients/${slug}/briefs/${briefId}`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function createStandaloneBrief(slug: string, formData: FormData) {
  const user = await requireUser();
  const id = await withUser(user.id, (tx) => tx<{ id: string }[]>`
    insert into public.briefs (client_id, title, owner_id) values (${String(formData.get("client_id"))}, ${String(formData.get("title"))}, ${user.id}) returning id`);
  redirect(`/clients/${slug}/briefs/${id[0].id}`);
}
