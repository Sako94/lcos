"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { runJob } from "@/lib/agent/runner";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function setFindingStatus(slug: string, findingId: string, status: "confirmed" | "dismissed" | "promoted", formData?: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const reason = formData ? String(formData.get("dismiss_reason") ?? "") : "";
  const readout = formData ? String(formData.get("next_readout") ?? "").trim() : "";
  try {
    await withUser(user.id, async (tx) => {
      if (status === "promoted") {
        const f = (await tx<{ clientId: string; title: string; nextAction: string | null }[]>`select client_id, title, next_action from public.findings where id = ${findingId}`)[0];
        const t = await tx<{ id: string }[]>`
          insert into public.tasks (client_id, title, description, owner_id, status, linked_type, linked_id)
          values (${f.clientId}, ${f.title}, ${f.nextAction}, ${user.id}, 'todo', 'finding', ${findingId}) returning id`;
        await tx`update public.findings set status = 'promoted', next_readout = coalesce(${readout || null}, next_readout) where id = ${findingId}`;
        return t[0].id;
      }
      await tx`update public.findings set status = ${status}::app.finding_status, dismiss_reason = ${reason || null} where id = ${findingId}`;
    });
    revalidatePath(`/clients/${slug}/audit`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function scoreArea(slug: string, auditId: string, area: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const score = Number(formData.get("score"));
  const reason = String(formData.get("reason") ?? "").trim();
  const evidence = String(formData.get("evidence_url") ?? "").trim();
  if (!evidence || !reason) return { ok: false, error: "A score needs evidence and a one-line reason (otherwise it stays Unscored)" };
  try {
    await withUser(user.id, async (tx) => {
      const entry = { score, reason, evidence_url: evidence, set_by_kind: "user", verified: true, set_by: user.id, set_at: new Date().toISOString() };
      await tx`update public.audits set scores = scores || ${tx.json({ [area]: entry })}::jsonb, overall = app.audit_overall(scores || ${tx.json({ [area]: entry })}::jsonb, template_version) where id = ${auditId}`;
    });
    revalidatePath(`/clients/${slug}/audit`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setAuditStatus(slug: string, auditId: string, status: "reviewed" | "published"): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.audits set status = ${status}::app.audit_status where id = ${auditId}`);
    revalidatePath(`/clients/${slug}/audit`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function createAudit(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(formData.get("client_id"));
  const kind = String(formData.get("kind"));
  const start = String(formData.get("period_start"));
  const end = String(formData.get("period_end"));
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.audits (client_id, template_version, kind, period_start, period_end, status, run_by)
      values (${clientId}, (select max(version) from public.audit_templates), ${kind}::app.audit_kind, ${start}::date, ${end}::date, 'scheduled', ${user.id})`);
    revalidatePath(`/clients/${slug}/audit`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function runHealthReview(slug: string, clientId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role === "contributor") return { ok: false, error: "Contributors cannot run agent jobs" };
  const r = await runJob({ clientId, jobType: "health_review", requestedBy: user.id });
  revalidatePath(`/clients/${slug}/audit`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function addFinding(slug: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const clientId = String(formData.get("client_id"));
  const auditId = String(formData.get("audit_id") ?? "") || null;
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.findings (client_id, audit_id, area, title, detail, evidence_url, severity, confidence, impact, effort, next_action, created_by)
      values (${clientId}, ${auditId}, ${String(formData.get("area"))}, ${String(formData.get("title"))}, ${String(formData.get("detail") ?? "") || null},
              ${String(formData.get("evidence_url") ?? "") || null}, ${Number(formData.get("severity"))}, ${String(formData.get("confidence"))}::app.confidence,
              ${Number(formData.get("impact")) || null}, ${Number(formData.get("effort")) || null}, ${String(formData.get("next_action") ?? "") || null}, ${user.id})`);
    revalidatePath(`/clients/${slug}/audit`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
