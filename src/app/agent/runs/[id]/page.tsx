import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Card, Chip, PageHeader, fmtDate } from "@/components/ui";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const run = (await withUser(user.id, (tx) => tx<{ id: string; clientName: string; jobType: string; status: string; attempt: number; startedAt: string | null; finishedAt: string | null; inputs: unknown; outputs: unknown; recordsTouched: unknown; error: string | null; idempotencyKey: string }[]>`
    select r.id, c.name as client_name, r.job_type, r.status, r.attempt, r.started_at, r.finished_at, r.inputs, r.outputs, r.records_touched, r.error, r.idempotency_key
    from public.agent_runs r join public.clients c on c.id = r.client_id where r.id = ${id}`))[0];
  if (!run) notFound();
  return (
    <>
      <PageHeader title={`Run · ${run.jobType.replaceAll("_", " ")}`} subtitle={<>{run.clientName} · <Chip value={run.status} /> · attempt {run.attempt} · started {run.startedAt ? fmtDate(run.startedAt) : "—"} · finished {run.finishedAt ? fmtDate(run.finishedAt) : "—"}</>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Inputs"><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.inputs, null, 2)}</pre></Card>
        <Card title="Outputs"><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.outputs, null, 2)}</pre></Card>
        <Card title="Records touched"><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.recordsTouched, null, 2)}</pre></Card>
        <Card title="Error and key">
          <p className="text-sm text-red-700">{run.error ?? "none"}</p>
          <p className="mt-2 font-mono text-xs text-neutral-500">{run.idempotencyKey}</p>
        </Card>
      </div>
    </>
  );
}
