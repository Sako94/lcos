"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addJourney(slug: string, clientId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.journeys (client_id, stage, name, purpose, entry_condition, exit_condition, sort_order)
      values (${clientId}, ${s(formData, "stage")}::app.journey_stage, ${s(formData, "name")}, ${s(formData, "purpose") || null}, ${s(formData, "entry_condition") || null}, ${s(formData, "exit_condition") || null},
              (select coalesce(max(sort_order), 0) + 1 from public.journeys where client_id = ${clientId}))`);
    revalidatePath(`/clients/${slug}/journeys`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setJourneyStatus(slug: string, journeyId: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.journeys set status = ${status}::app.journey_status where id = ${journeyId}`);
    revalidatePath(`/clients/${slug}/journeys`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** bindings arrive as lines "TOKEN=fact_id"; do_not_send as lines */
export async function addStep(slug: string, clientId: string, journeyId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const bindings = s(formData, "bindings").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [token, fact_id] = l.split("="); return { token: (token ?? "").trim().replace(/^\[\[|\]\]$/g, ""), fact_id: (fact_id ?? "").trim() }; });
  const dns = s(formData, "do_not_send").split("\n").map((l) => l.trim()).filter(Boolean);
  try {
    await withUser(user.id, async (tx) => {
      // a binding may name the fact by the 8-character prefix shown on screen
      for (const b of bindings) {
        if (b.fact_id && b.fact_id.length < 36) {
          const m = await tx<{ id: string }[]>`select id from public.facts where client_id = ${clientId} and id::text like ${b.fact_id + "%"}`;
          if (m.length === 1) b.fact_id = m[0].id;
        }
      }
      await tx`
      insert into public.journey_steps (client_id, journey_id, position, channel, name, anchor, delay_hours, subject, draft_body, do_not_send, bindings, current_flow_id)
      values (${clientId}, ${journeyId}, (select coalesce(max(position), 0) + 1 from public.journey_steps where journey_id = ${journeyId}),
              ${s(formData, "channel") || "email"}::app.channel, ${s(formData, "name")}, ${s(formData, "anchor") || "entry"}, ${Number(s(formData, "delay_hours") || 0)},
              ${s(formData, "subject") || null}, ${s(formData, "draft_body") || null}, ${tx.json(dns)}, ${tx.json(bindings)}, ${s(formData, "current_flow_id") || null})`;
    });
    revalidatePath(`/clients/${slug}/journeys`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setStepStatus(slug: string, stepId: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.journey_steps set status = ${status}::app.step_status where id = ${stepId}`);
    revalidatePath(`/clients/${slug}/journeys`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function mapStepToFlow(slug: string, stepId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.journey_steps set current_flow_id = ${s(formData, "current_flow_id") || null} where id = ${stepId}`);
    revalidatePath(`/clients/${slug}/journeys`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
