import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Card, Chip, Empty, PageHeader, Table, fmtDate, AgentTag } from "@/components/ui";

export default async function Home() {
  const user = await requireUser();
  const data = await withUser(user.id, async (tx) => {
    const briefs = await tx<{ id: string; title: string; status: string; clientName: string; slug: string; updatedAt: string }[]>`
      select b.id, b.title, b.status, c.name as client_name, c.slug, b.updated_at from public.briefs b join public.clients c on c.id = b.client_id
      where b.status in ('copy_review','qa','internal_approved') order by b.updated_at desc limit 20`;
    const cycles = await tx<{ id: string; objective: string; status: string; clientName: string; slug: string }[]>`
      select cy.id, cy.objective, cy.status, c.name as client_name, c.slug from public.cycles cy join public.clients c on c.id = cy.client_id
      where cy.status in ('draft','internal_review') order by cy.starts_on`;
    const findings = await tx<{ id: string; title: string; severity: number; clientName: string; slug: string; agentRunId: string | null; createdByKind: string }[]>`
      select f.id, f.title, f.severity, c.name as client_name, c.slug, f.agent_run_id, f.created_by_kind from public.findings f join public.clients c on c.id = f.client_id
      where f.status = 'new' order by f.severity, f.created_at desc limit 20`;
    const requests = await tx<{ id: string; action: string; clientName: string; slug: string; createdAt: string }[]>`
      select r.id, r.action, c.name as client_name, c.slug, r.created_at from public.approval_requests r join public.clients c on c.id = r.client_id
      where r.status = 'pending' order by r.created_at`;
    const overdue = await tx<{ id: string; title: string; dueOn: string; owner: string; clientName: string; slug: string }[]>`
      select t.id, t.title, t.due_on, p.full_name as owner, c.name as client_name, c.slug from public.tasks t
      join public.clients c on c.id = t.client_id left join public.profiles p on p.id = t.owner_id
      where t.status not in ('done','cancelled') and t.due_on < current_date order by t.due_on`;
    const commitments = await tx<{ id: string; statement: string; dueOn: string; owner: string; clientName: string }[]>`
      select cm.id, cm.statement, cm.due_on, p.full_name as owner, c.name as client_name from public.commitments cm
      join public.clients c on c.id = cm.client_id join public.profiles p on p.id = cm.owner_id
      where cm.status = 'open' order by cm.due_on limit 10`;
    const meetings = await tx<{ id: string; scheduledAt: string; status: string; clientName: string; slug: string }[]>`
      select m.id, m.scheduled_at, m.status, c.name as client_name, c.slug from public.meetings m join public.clients c on c.id = m.client_id
      where m.status in ('planned','pre_read_sent') and m.scheduled_at > now() - interval '1 day' order by m.scheduled_at limit 5`;
    const runs = await tx<{ id: string; jobType: string; status: string; clientName: string; createdAt: string; error: string | null }[]>`
      select r.id, r.job_type, r.status, c.name as client_name, r.created_at, r.error from public.agent_runs r join public.clients c on c.id = r.client_id
      order by r.created_at desc limit 8`;
    return { briefs, cycles, findings, requests, overdue, commitments, meetings, runs };
  });

  return (
    <>
      <PageHeader title="Agency home" subtitle="Approval queue, overdue work, agent findings across your assigned clients." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Approval queue">
          {data.briefs.length + data.cycles.length + data.requests.length === 0 ? (
            <Empty>Nothing waiting for approval.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.cycles.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link href={`/clients/${c.slug}/calendar`} className="hover:underline">
                    Cycle plan · {c.clientName}: {c.objective?.slice(0, 80)}
                  </Link>
                  <Chip value={c.status} />
                </li>
              ))}
              {data.briefs.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <Link href={`/clients/${b.slug}/briefs/${b.id}`} className="hover:underline">
                    Brief · {b.clientName}: {b.title}
                  </Link>
                  <Chip value={b.status} />
                </li>
              ))}
              {data.requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link href="/agent" className="hover:underline">
                    Agent request · {r.clientName}: {r.action}
                  </Link>
                  <Chip value="pending" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="New findings to review">
          {data.findings.length === 0 ? (
            <Empty>No unreviewed findings.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.findings.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <Link href={`/clients/${f.slug}/audit`} className="hover:underline">
                    <span className="mr-2 rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white">S{f.severity}</span>
                    {f.clientName}: {f.title}
                  </Link>
                  {f.createdByKind === "agent" ? <AgentTag runId={f.agentRunId} /> : <Chip value="user" />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Overdue tasks">
          {data.overdue.length === 0 ? (
            <Empty>No overdue tasks.</Empty>
          ) : (
            <Table head={["Task", "Client", "Owner", "Due"]}>
              {data.overdue.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-4">{t.title}</td>
                  <td className="py-2 pr-4">{t.clientName}</td>
                  <td className="py-2 pr-4">{t.owner}</td>
                  <td className="py-2 pr-4 text-red-700">{fmtDate(t.dueOn)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Open commitments">
          {data.commitments.length === 0 ? (
            <Empty>No open commitments.</Empty>
          ) : (
            <Table head={["Commitment", "Client", "Owner", "Due"]}>
              {data.commitments.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-4">{c.statement}</td>
                  <td className="py-2 pr-4">{c.clientName}</td>
                  <td className="py-2 pr-4">{c.owner}</td>
                  <td className="py-2 pr-4">{fmtDate(c.dueOn)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Upcoming meetings">
          {data.meetings.length === 0 ? (
            <Empty>No meetings scheduled.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.meetings.map((m) => (
                <li key={m.id} className="flex items-center justify-between">
                  <Link href={`/clients/${m.slug}/meetings/${m.id}`} className="hover:underline">
                    {m.clientName} · {new Date(m.scheduledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </Link>
                  <Chip value={m.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent agent runs">
          {data.runs.length === 0 ? (
            <Empty>The agent has not run yet.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link href={`/agent/runs/${r.id}`} className="hover:underline">
                    {r.clientName} · {r.jobType.replaceAll("_", " ")} · {fmtDate(r.createdAt)}
                  </Link>
                  <Chip value={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
