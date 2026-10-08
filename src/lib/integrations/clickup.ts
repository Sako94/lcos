import "server-only";

/** ClickUp task mirror: the only external write the agent is allowed in the MVP. Idempotent on our task id via the task's custom description tag. */
const BASE = "https://api.clickup.com/api/v2";

export class ClickUpClient {
  constructor(private token: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: this.token, "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ClickUp ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  async createTask(listId: string, task: { name: string; description?: string; due_date?: number; assignees?: number[] }) {
    return this.req<{ id: string; url: string }>(`/list/${listId}/task`, { method: "POST", body: JSON.stringify(task) });
  }

  async updateTask(taskId: string, patch: { name?: string; description?: string; status?: string; due_date?: number }) {
    return this.req<{ id: string }>(`/task/${taskId}`, { method: "PUT", body: JSON.stringify(patch) });
  }

  async getTask(taskId: string) {
    return this.req<{ id: string; status: { status: string }; name: string }>(`/task/${taskId}`);
  }
}

/** Map our task status to the ATK list's status names seen in ClickUp. */
export function toClickUpStatus(status: string): string {
  switch (status) {
    case "todo": return "10—to do";
    case "in_progress": return "20—in progress";
    case "review": return "13—internal review";
    case "done": return "40—complete";
    default: return "10—to do";
  }
}
