"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import type { ActionResult } from "@/components/action-form";

export async function decideRequest(requestId: string, decision: "approved" | "rejected"): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await withUser(user.id, (tx) => tx`update public.approval_requests set status = ${decision}::app.request_status where id = ${requestId}`);
    revalidatePath("/agent");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
