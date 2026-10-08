import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Card, Chip, Empty, PageHeader, Table, fmtDate } from "@/components/ui";
import { ActionButton } from "@/components/action-form";
import { decideRequest } from "./actions";

export default async function AgentPage() {
  const user = await requireUser();
  const d = await withUser(user.id, async (tx) => {
    const jobs = await tx<{ id: string; clientName: string; jobType: string; schedule: string | null; enabled: boolean; lastRunAt: string | null }[]>`
      select j.id, c.name as client_name, j.job_type, j.schedule, j.enabled, j.last_run_at from public.agent_jobs j join public.clients c on c.id = j.client_id order by c.name, j.job_type`;
    const runs = await tx<{ id: string; clientName: string; jobType: string; status: string; attempt: number; startedAt: string | null; finishedAt: string | null; summary: string | null; error: string | null }[]>`
      select r.id, c.name as client_name, r.job_type, r.status, r.attempt, r.started_at, r.finished_at, r.outputs->>'summary' as summary, r.error
      from public.agent_runs r join public.clients c on c.id = r.client_id order by r.created_at desc limit 50`;
    const requests = await tx<{ id: string; clientName: string; action: string; payload: unknown; status: string; createdAt: string }[]>`
      select r.id, c.name as client_name, r.action, r.payload, r.status, r.created_at from public.approval_requests r join public.clients c on c.id = r.client_id order by r.created_at desc limit 20`;
    return { jobs, runs, requests };
  });
  return (
    <>
      <PageHeader title="Agent activity" subtitle="Scheduled jobs, execution history, and actions waiting for a person. Every output on other screens links back here." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Jobs">
          <Table head={["Client", "Job", "Schedule", "Enabled", "Last run"]}>
            {d.jobs.map((j) => (
              <tr key={j.id}>
                <td className="py-2 pr-4">{j.clientName}</td>
                <td className="py-2 pr-4">{j.jobType.replaceAll("_", " ")}</td>
                <td className="py-2 pr-4 font-mono text-xs">{j.schedule ?? "on demand"}</td>
                <td className="py-2 pr-4">{j.enabled ? "yes" : "no"}</td>
                <td className="py-2 pr-4">{j.lastRunAt ? fmtDate(j.lastRunAt) : "never"}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-neutral-500">Scheduled jobs are triggered by POST /api/jobs/run with the CRON_SECRET (Vercel Cron, Supabase cron, or any scheduler). Duplicate runs in a day are blocked by the idempotency key.</p>
        </Card>
        <Card title="Awaiting approval">
          {d.requests.filter((r) => r.status === "pending").length === 0 ? <Empty>No agent actions waiting.</Empty> : null}
          <ul className="space-y-2 text-sm">
            {d.requests.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2">
                <span>{r.clientName} · {r.action}<span className="block text-xs text-neutral-500">{fmtDate(r.createdAt)} · {JSON.stringify(r.payload).slice(0, 120)}</span></span>
                <span className="flex flex-col items-end gap-1">
                  <Chip value={r.status} />
                  {r.status === "pending" && user.role === "admin" ? (
                    <span className="flex gap-2">
                      <ActionButton action={decideRequest.bind(null, r.id, "approved")} className="text-xs underline">approve</ActionButton>
                      <ActionButton action={decideRequest.bind(null, r.id, "rejected")} className="text-xs text-red-700 underline">reject</ActionButton>
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Run history" className="lg:col-span-2">
          {d.runs.length === 0 ? <Empty>No runs yet.</Empty> : (
            <Table head={["When", "Client", "Job", "Status", "Attempt", "Result"]}>
              {d.runs.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4"><Link className="underline" href={`/agent/runs/${r.id}`}>{r.startedAt ? new Date(r.startedAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "—"}</Link></td>
                  <td className="py-2 pr-4">{r.clientName}</td>
                  <td className="py-2 pr-4">{r.jobType.replaceAll("_", " ")}</td>
                  <td className="py-2 pr-4"><Chip value={r.status} /></td>
                  <td className="py-2 pr-4">{r.attempt}</td>
                  <td className="py-2 pr-4 text-xs">{r.error ? <span className="text-red-700">{r.error.slice(0, 160)}</span> : r.summary}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
