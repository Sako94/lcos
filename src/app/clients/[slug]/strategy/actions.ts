"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** levers arrive as lines "name | amount | gate" */
export async function proposeTarget(slug: string, clientId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const levers = s(formData, "levers").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, amount, gate] = l.split("|").map((x) => x.trim());
    return { name, amount: Number(amount) || 0, gate: gate ?? "", gate_status: "open" };
  });
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.targets (client_id, period, metric_key, floor_value, record_value, stretch_value, basis, levers, created_by)
      values (${clientId}, ${s(formData, "period")}, ${s(formData, "metric_key")}, ${Number(s(formData, "floor_value")) || null}, ${Number(s(formData, "record_value")) || null},
              ${Number(s(formData, "stretch_value")) || null}, ${s(formData, "basis") || null}, ${tx.json(levers)}, ${user.id})
      on conflict (client_id, period, metric_key) do update set floor_value = excluded.floor_value, record_value = excluded.record_value, stretch_value = excluded.stretch_value,
        basis = excluded.basis, levers = excluded.levers, status = 'proposed'`);
    revalidatePath(`/clients/${slug}/strategy`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setTargetStatus(slug: string, id: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.targets set status = ${status}::app.target_status where id = ${id}`);
    revalidatePath(`/clients/${slug}/strategy`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setLeverGate(slug: string, id: string, index: number, gateStatus: "open" | "passed" | "failed"): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.targets set levers = jsonb_set(levers, ${`{${index},gate_status}`}::text[], ${tx.json(gateStatus)}) where id = ${id}`);
    revalidatePath(`/clients/${slug}/strategy`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function saveContactPolicy(slug: string, clientId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const policy = {
    email_max_per_week: Number(s(formData, "email_max_per_week")) || 4,
    sms_max_per_week: Number(s(formData, "sms_max_per_week")) || 2,
    promo_streak_max: Number(s(formData, "promo_streak_max")) || 1,
    quiet_hours: { start: s(formData, "quiet_start") || "21:00", end: s(formData, "quiet_end") || "08:00", tz: s(formData, "tz") || "America/Los_Angeles" },
    collision_rule: s(formData, "collision_rule"),
  };
  const approved = s(formData, "approved_domains").split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const oldTerms = s(formData, "old_brand_terms").split("\n").map((x) => x.trim()).filter(Boolean);
  try {
    await withUser(user.id, (tx) => tx`update public.clients set contact_policy = ${tx.json(policy)}, approved_domains = ${approved}, old_brand_terms = ${oldTerms} where id = ${clientId}`);
    revalidatePath(`/clients/${slug}/strategy`);
    revalidatePath(`/clients/${slug}/calendar`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
