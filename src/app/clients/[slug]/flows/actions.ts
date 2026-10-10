"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { runJob } from "@/lib/agent/runner";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function updateFlow(slug: string, flowId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const logic = formData.has("documented_logic") ? String(formData.get("documented_logic")) : undefined;
  const rebuild = formData.has("rebuild_status") ? String(formData.get("rebuild_status")) : undefined;
  const design = formData.has("design_url") ? String(formData.get("design_url")) || null : undefined;
  try {
    await withUser(user.id, async (tx) => {
      if (logic !== undefined) await tx`update public.flows set documented_logic = ${logic} where id = ${flowId}`;
      if (rebuild !== undefined) await tx`update public.flows set rebuild_status = ${rebuild}::app.rebuild_status where id = ${flowId}`;
      if (design !== undefined) await tx`update public.flows set design_url = ${design} where id = ${flowId}`;
    });
    revalidatePath(`/clients/${slug}/flows`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function proposeChange(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.proposed_changes (client_id, flow_id, title, before_logic, after_logic, rationale, proposed_by)
      values (${String(formData.get("client_id"))}, ${String(formData.get("flow_id"))}, ${String(formData.get("title"))},
              ${String(formData.get("before_logic") ?? "") || null}, ${String(formData.get("after_logic"))}, ${String(formData.get("rationale") ?? "") || null}, ${user.id})`);
    revalidatePath(`/clients/${slug}/flows`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setChangeStatus(slug: string, changeId: string, status: "approved" | "rejected" | "applied" | "verified"): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.proposed_changes set status = ${status}::app.change_status ${status === "verified" ? tx`, verified_at = now()` : tx``} where id = ${changeId}`);
    revalidatePath(`/clients/${slug}/flows`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function syncFlows(slug: string, clientId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "contributor") return { ok: false, error: "Contributors cannot run agent jobs" };
  const r = await runJob({ clientId, jobType: "flow_sync", requestedBy: user.id });
  revalidatePath(`/clients/${slug}/flows`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function draftFlowLogic(slug: string, clientId: string, flowId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "contributor") return { ok: false, error: "Contributors cannot run agent jobs" };
  const r = await runJob({ clientId, jobType: "flow_logic_doc", requestedBy: user.id, inputs: { flowId } });
  revalidatePath(`/clients/${slug}/flows`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function runLinkCheck(slug: string, clientId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "contributor") return { ok: false, error: "Contributors cannot run agent jobs" };
  const r = await runJob({ clientId, jobType: "link_check", requestedBy: user.id });
  revalidatePath(`/clients/${slug}/flows`);
  revalidatePath(`/clients/${slug}/audit`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
