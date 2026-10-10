"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ActionResult } from "@/components/action-form";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function proposeExperiment(slug: string, clientId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`
      insert into public.experiments (client_id, name, hypothesis, treatment, control, primary_metric, min_sample, stop_rule, starts_on, readout_on, finding_id, owner_id)
      values (${clientId}, ${s(formData, "name")}, ${s(formData, "hypothesis")}, ${s(formData, "treatment") || null}, ${s(formData, "control") || null}, ${s(formData, "primary_metric") || null},
              ${s(formData, "min_sample") ? Number(s(formData, "min_sample")) : null}, ${s(formData, "stop_rule") || null}, ${s(formData, "starts_on") || null}, ${s(formData, "readout_on") || null},
              ${s(formData, "finding_id") || null}, ${user.id})`);
    revalidatePath(`/clients/${slug}/experiments`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function setExperimentStatus(slug: string, id: string, status: string, formData?: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const conclusion = formData ? s(formData, "conclusion") : "";
  const result = formData ? s(formData, "result") : "";
  try {
    await withUser(user.id, (tx) => tx`
      update public.experiments set status = ${status}::app.experiment_status,
        conclusion = coalesce(${conclusion || null}, conclusion),
        result = coalesce(${result ? tx.json({ note: result }) : null}, result)
      where id = ${id}`);
    revalidatePath(`/clients/${slug}/experiments`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
