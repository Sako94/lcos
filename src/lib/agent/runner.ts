import "server-only";
import type postgres from "postgres";
import { withAgent, withService, type Tx } from "@/lib/db";
import { healthReview } from "./jobs/health-review";
import { flowSync } from "./jobs/flow-sync";
import { flowLogicDoc } from "./jobs/flow-logic-doc";
import { briefDraft } from "./jobs/brief-draft";
import { meetingPreread } from "./jobs/meeting-preread";

export type JobType = "health_review" | "flow_sync" | "flow_logic_doc" | "brief_draft" | "meeting_preread";

export type JobContext = {
  tx: Tx;
  clientId: string;
  slug: string;
  runId: string;
  inputs: Record<string, unknown>;
  touched: (type: string, id: string) => void;
};

export type JobResult = { summary: string; outputs?: Record<string, unknown>; needsApproval?: { action: string; payload: Record<string, unknown> } };

const JOBS: Record<JobType, (ctx: JobContext) => Promise<JobResult>> = {
  health_review: healthReview,
  flow_sync: flowSync,
  flow_logic_doc: flowLogicDoc,
  brief_draft: briefDraft,
  meeting_preread: meetingPreread,
};

const MAX_ATTEMPTS = 3;

/**
 * Runs a job under the agent identity with an idempotency key, retries, and a run log.
 * Scheduled runs use job:client:date so the same job cannot run twice in a day.
 * Manual runs (requestedBy set) use minute granularity: re-runnable, but double-clicks collapse.
 */
export async function runJob(opts: { clientId: string; jobType: JobType; requestedBy?: string; inputs?: Record<string, unknown>; scheduled?: boolean }) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const key = opts.scheduled
    ? `${opts.jobType}:${opts.clientId}:${day}`
    : `${opts.jobType}:${opts.clientId}:${now.toISOString().slice(0, 16)}:${opts.requestedBy ?? "manual"}:${JSON.stringify(opts.inputs ?? {})}`;

  const client = await withService((tx) => tx<{ slug: string }[]>`select slug from public.clients where id = ${opts.clientId}`);
  if (!client[0]) return { ok: false as const, error: "Unknown client" };
  const slug = client[0].slug;

  let runId: string;
  try {
    const r = await withService(
      (tx) => tx<{ id: string }[]>`
        insert into public.agent_runs (job_id, client_id, job_type, idempotency_key, status, inputs, started_at)
        values ((select id from public.agent_jobs where client_id = ${opts.clientId} and job_type = ${opts.jobType}),
                ${opts.clientId}, ${opts.jobType}, ${key}, 'running', ${tx.json({ ...(opts.inputs ?? {}), requestedBy: opts.requestedBy ?? null, scheduled: !!opts.scheduled })}, now())
        returning id`,
    );
    runId = r[0].id;
  } catch (e) {
    if (String(e).includes("idempotency_key")) return { ok: false as const, error: "This job already ran for this period (idempotency key)." };
    throw e;
  }

  const touched: { type: string; id: string }[] = [];
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await withAgent(opts.clientId, (tx) =>
        JOBS[opts.jobType]({ tx, clientId: opts.clientId, slug, runId, inputs: opts.inputs ?? {}, touched: (type, id) => touched.push({ type, id }) }),
      );
      await withService(async (tx) => {
        if (result.needsApproval) {
          await tx`insert into public.approval_requests (client_id, agent_run_id, action, payload) values (${opts.clientId}, ${runId}, ${result.needsApproval.action}, ${tx.json(result.needsApproval.payload as postgres.JSONValue)})`;
        }
        await tx`update public.agent_runs set status = ${result.needsApproval ? "needs_approval" : "succeeded"}, attempt = ${attempt}, finished_at = now(),
                 outputs = ${tx.json({ summary: result.summary, ...(result.outputs ?? {}) })}, records_touched = ${tx.json(touched)} where id = ${runId}`;
        await tx`update public.agent_jobs set last_run_at = now() where client_id = ${opts.clientId} and job_type = ${opts.jobType}`;
      });
      return { ok: true as const, runId, summary: result.summary };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const retryable = !/not set|not configured|Unknown|cannot|requires|forbidden/i.test(lastError);
      await withService((tx) => tx`update public.agent_runs set attempt = ${attempt}, error = ${lastError} where id = ${runId}`);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  // final failure: record it and alert the account lead with a task
  await withService(async (tx) => {
    await tx`update public.agent_runs set status = 'failed', finished_at = now(), error = ${lastError} where id = ${runId}`;
    await tx`insert into public.tasks (client_id, title, description, owner_id, status, linked_type, linked_id)
             select ${opts.clientId}, ${"Agent job failed: " + opts.jobType}, ${lastError}, a.user_id, 'todo', 'agent_run', ${runId}
             from public.client_assignments a where a.client_id = ${opts.clientId} and a.role_on_client = 'account_lead' limit 1`;
  });
  return { ok: false as const, error: lastError, runId };
}
