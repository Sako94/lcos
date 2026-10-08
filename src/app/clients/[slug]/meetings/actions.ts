"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser, withService } from "@/lib/db";
import { runJob } from "@/lib/agent/runner";
import { mirrorTaskToClickUp } from "@/lib/integrations/mirror";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createMeeting(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`insert into public.meetings (client_id, scheduled_at) values (${String(formData.get("client_id"))}, ${String(formData.get("scheduled_at"))}::timestamptz)`);
    revalidatePath(`/clients/${slug}/meetings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function updateMeeting(slug: string, meetingId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const f = (k: string) => (formData.has(k) ? String(formData.get(k)) || null : undefined);
  try {
    await withUser(user.id, async (tx) => {
      const pre = f("pre_read"), agenda = f("agenda"), transcript = f("transcript_url"), status = f("status");
      if (pre !== undefined) await tx`update public.meetings set pre_read = ${pre} where id = ${meetingId}`;
      if (agenda !== undefined) await tx`update public.meetings set agenda = ${agenda} where id = ${meetingId}`;
      if (transcript !== undefined) await tx`update public.meetings set transcript_url = ${transcript} where id = ${meetingId}`;
      if (status) await tx`update public.meetings set status = ${status}::app.meeting_status where id = ${meetingId}`;
    });
    revalidatePath(`/clients/${slug}/meetings/${meetingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function addDecision(slug: string, meetingId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.decisions (client_id, meeting_id, statement, decided_by, recorded_by, changes_fact_id)
      values (${String(formData.get("client_id"))}, ${meetingId}, ${String(formData.get("statement"))}, ${String(formData.get("decided_by") ?? "") || null}, ${user.id}, ${String(formData.get("changes_fact_id") ?? "") || null})`);
    revalidatePath(`/clients/${slug}/meetings/${meetingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function addCommitment(slug: string, meetingId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(formData.get("client_id"));
  const statement = String(formData.get("statement") ?? "").trim();
  const ownerId = String(formData.get("owner_id") ?? "");
  const dueOn = String(formData.get("due_on") ?? "");
  if (!ownerId) return { ok: false, error: "A commitment without an owner cannot be saved (SOP 9)" };
  try {
    const taskId = await withUser(user.id, async (tx) => {
      const t = await tx<{ id: string }[]>`
        insert into public.tasks (client_id, title, owner_id, due_on, status, linked_type, linked_id)
        values (${clientId}, ${statement}, ${ownerId}, ${dueOn}::date, 'todo', 'commitment', ${meetingId}) returning id`;
      await tx`insert into public.commitments (client_id, meeting_id, statement, owner_id, due_on, task_id) values (${clientId}, ${meetingId}, ${statement}, ${ownerId}, ${dueOn}::date, ${t[0].id})`;
      return t[0].id;
    });
    // mirror to ClickUp (best effort; the record exists either way)
    await mirrorTaskToClickUp(taskId).catch(() => {});
    revalidatePath(`/clients/${slug}/meetings/${meetingId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setCommitmentStatus(slug: string, meetingId: string, commitmentId: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const taskId = await withUser(user.id, async (tx) => {
      const r = await tx<{ taskId: string | null }[]>`update public.commitments set status = ${status}::app.commitment_status where id = ${commitmentId} returning task_id`;
      if (r[0]?.taskId) await tx`update public.tasks set status = ${status === "done" ? "done" : status === "dropped" ? "cancelled" : "todo"}::app.task_status where id = ${r[0].taskId}`;
      return r[0]?.taskId ?? null;
    });
    if (taskId) await mirrorTaskToClickUp(taskId).catch(() => {});
    revalidatePath(`/clients/${slug}/meetings/${meetingId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function draftPreread(slug: string, clientId: string, meetingId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "contributor") return { ok: false, error: "Contributors cannot run agent jobs" };
  const r = await runJob({ clientId, jobType: "meeting_preread", requestedBy: user.id, inputs: { meetingId } });
  revalidatePath(`/clients/${slug}/meetings/${meetingId}`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function teamForClient(clientId: string) {
  return withService((tx) => tx<{ id: string; fullName: string }[]>`
    select p.id, p.full_name from public.client_assignments a join public.profiles p on p.id = a.user_id where a.client_id = ${clientId} order by p.full_name`);
}
