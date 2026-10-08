import { NextResponse } from "next/server";
import { withService } from "@/lib/db";
import { runJob, type JobType } from "@/lib/agent/runner";

/**
 * Scheduler entry point. POST with header `x-cron-secret: $CRON_SECRET`.
 * Body (optional): { jobType?: string, clientId?: string }. Without a body it runs every enabled scheduled job
 * for every active client, once per day each (idempotency key = job:client:date).
 */
export async function POST(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { jobType?: JobType; clientId?: string };
  const jobs = await withService((tx) => tx<{ clientId: string; jobType: JobType }[]>`
    select j.client_id, j.job_type from public.agent_jobs j join public.clients c on c.id = j.client_id
    where j.enabled and c.active and j.schedule is not null
      ${body.jobType ? tx`and j.job_type = ${body.jobType}` : tx``} ${body.clientId ? tx`and j.client_id = ${body.clientId}` : tx``}`);
  const results = [];
  for (const j of jobs) results.push({ ...j, ...(await runJob({ clientId: j.clientId, jobType: j.jobType, scheduled: true })) });
  return NextResponse.json({ ran: results.length, results });
}
