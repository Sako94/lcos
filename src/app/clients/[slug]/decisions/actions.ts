"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function openDecision(slug: string, clientId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, async (tx) => {
      const r = await tx<{ id: string }[]>`
        insert into public.decisions (client_id, statement, status, owner_side, owner_role, owner_name, unlocks, due_on, options, recorded_by)
        values (${clientId}, ${s(formData, "statement")}, 'open', ${s(formData, "owner_side") || null}::app.party, ${s(formData, "owner_role") || null}, ${s(formData, "owner_name") || null},
                ${s(formData, "unlocks") || null}, ${s(formData, "due_on") || null}, ${tx.json(s(formData, "options").split("\n").map((x) => x.trim()).filter(Boolean))}, ${user.id})
        returning id`;
      const rt = s(formData, "record_type"), rid = s(formData, "record_id");
      if (rt && rid) await tx`insert into public.decision_links (client_id, decision_id, record_type, record_id) values (${clientId}, ${r[0].id}, ${rt}, ${rid}) on conflict do nothing`;
    });
    revalidatePath(`/clients/${slug}/decisions`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function decide(slug: string, decisionId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, async (tx) => {
      const d = (await tx<{ changesFactId: string | null }[]>`select changes_fact_id from public.decisions where id = ${decisionId}`)[0];
      await tx`update public.decisions set status = 'decided', outcome = ${s(formData, "outcome")}, decided_by = ${s(formData, "decided_by")}, decided_on = current_date where id = ${decisionId}`;
      // SOP 9 rule: a decision that changes an Approved fact reopens it as Proposed (the facts trigger handles the version)
      if (d?.changesFactId) await tx`update public.facts set statement = statement where id = ${d.changesFactId}`;
    });
    revalidatePath(`/clients/${slug}/decisions`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function linkDecision(slug: string, clientId: string, decisionId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`insert into public.decision_links (client_id, decision_id, record_type, record_id) values (${clientId}, ${decisionId}, ${s(formData, "record_type")}, ${s(formData, "record_id")}) on conflict do nothing`);
    revalidatePath(`/clients/${slug}/decisions`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
