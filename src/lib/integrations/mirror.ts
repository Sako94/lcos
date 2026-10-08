import "server-only";
import { withService } from "@/lib/db";
import { ClickUpClient, toClickUpStatus } from "./clickup";
import { clickupListId, clickupToken } from "./secrets";

/**
 * Mirror one task to ClickUp. Idempotent: a task that already has clickup_task_id is updated, never recreated.
 * Returns silently when ClickUp is not configured; the app's task record is the source of truth either way.
 */
export async function mirrorTaskToClickUp(taskId: string): Promise<{ mirrored: boolean; reason?: string }> {
  const token = clickupToken();
  const task = (await withService((tx) => tx<{ id: string; title: string; description: string | null; dueOn: string | null; status: string; clickupTaskId: string | null; slug: string }[]>`
    select t.id, t.title, t.description, t.due_on, t.status, t.clickup_task_id, c.slug from public.tasks t join public.clients c on c.id = t.client_id where t.id = ${taskId}`))[0];
  if (!task) return { mirrored: false, reason: "task not found" };
  const listId = clickupListId(task.slug);
  if (!token || !listId) return { mirrored: false, reason: "ClickUp not configured" };
  const cu = new ClickUpClient(token);
  const due = task.dueOn ? new Date(task.dueOn).getTime() : undefined;
  if (task.clickupTaskId) {
    await cu.updateTask(task.clickupTaskId, { name: task.title, status: toClickUpStatus(task.status), due_date: due });
  } else {
    const created = await cu.createTask(listId, { name: task.title, description: `${task.description ?? ""}\n\n[LCOS task ${task.id}]`, due_date: due });
    await withService((tx) => tx`update public.tasks set clickup_task_id = ${created.id} where id = ${taskId}`);
  }
  await withService((tx) => tx`update public.tasks set clickup_synced_at = now() where id = ${taskId}`);
  return { mirrored: true };
}
