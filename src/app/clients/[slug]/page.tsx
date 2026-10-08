import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { FACT_CATEGORIES, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, Table, fmtDate } from "@/components/ui";

export default async function ClientOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const integrations = await tx<{ system: string; mode: string; status: string; externalAccountName: string | null; scopeNote: string | null; lastVerifiedAt: string | null }[]>`
      select system, mode, status, external_account_name, scope_note, last_verified_at from public.integrations where client_id = ${client.id} order by system`;
    const cycle = (await tx<{ id: string; startsOn: string; endsOn: string; objective: string; status: string }[]>`
      select id, starts_on, ends_on, objective, status from public.cycles where client_id = ${client.id} order by starts_on desc limit 1`)[0];
    const audit = (await tx<{ id: string; kind: string; overall: string | null; status: string; periodEnd: string }[]>`
      select id, kind, overall, status, period_end from public.audits where client_id = ${client.id} order by created_at desc limit 1`)[0];
    const factCounts = await tx<{ category: string; status: string; n: number }[]>`
      select category, status, count(*)::int as n from public.facts where client_id = ${client.id} group by 1, 2`;
    const overdueFacts = await tx<{ n: number }[]>`
      select count(*)::int as n from public.facts where client_id = ${client.id} and review_due < current_date and status <> 'stale'`;
    const openFindings = await tx<{ n: number }[]>`select count(*)::int as n from public.findings where client_id = ${client.id} and status = 'new'`;
    const team = await tx<{ fullName: string; roleOnClient: string }[]>`
      select p.full_name, a.role_on_client from public.client_assignments a join public.profiles p on p.id = a.user_id where a.client_id = ${client.id} order by a.role_on_client`;
    const missingTasks = await tx<{ id: string; title: string; status: string; clickupTaskId: string | null }[]>`
      select id, title, status, clickup_task_id from public.tasks where client_id = ${client.id} and status not in ('done','cancelled') order by created_at`;
    return { integrations, cycle, audit, factCounts, overdueFacts: overdueFacts[0].n, openFindings: openFindings[0].n, team, missingTasks };
  });

  const emptyCategories = FACT_CATEGORIES.filter((c) => !d.factCounts.some((f) => f.category === c.key));
  const approvedCount = d.factCounts.filter((f) => f.status === "approved").reduce((a, b) => a + b.n, 0);
  const totalFacts = d.factCounts.reduce((a, b) => a + b.n, 0);

  return (
    <>
      <PageHeader
        title={client.name}
        subtitle={
          <>
            {client.website ? <a className="underline" href={client.website}>{client.website}</a> : null}
            {" · "}
            {d.team.map((t) => `${t.fullName} (${t.roleOnClient.replace("_", " ")})`).join(", ")}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Objective" className="lg:col-span-2">
          <p className="text-sm">{client.objective ?? "No objective recorded."}</p>
          {d.cycle ? (
            <p className="mt-3 text-sm">
              <span className="font-medium">Current cycle</span> {fmtDate(d.cycle.startsOn)} – {fmtDate(d.cycle.endsOn)} <Chip value={d.cycle.status} />
              <br />
              <span className="text-neutral-600">{d.cycle.objective}</span>
            </p>
          ) : (
            <Empty>No cycle yet. Create one on the calendar.</Empty>
          )}
        </Card>
        <Card title="Scorecard">
          {d.audit ? (
            <div className="text-sm">
              <p className="font-mono text-4xl font-bold text-lime">{d.audit.overall ?? "—"}<span className="ml-1 font-display text-xs uppercase tracking-[0.1em] text-fg-muted">/100</span></p>
              <p className="mt-1 text-neutral-600">
                {d.audit.kind.replace("_", " ")} audit to {fmtDate(d.audit.periodEnd)} · <Chip value={d.audit.status} />
              </p>
              <p className="mt-2">
                <Link className="underline" href={`/clients/${slug}/audit`}>{d.openFindings} findings to review</Link>
              </p>
            </div>
          ) : (
            <Empty>No audit yet.</Empty>
          )}
        </Card>
        <Card title="Source of Truth">
          <p className="text-sm">
            {totalFacts} facts · {approvedCount} approved · {d.overdueFacts} past review date
          </p>
          {emptyCategories.length ? (
            <p className="mt-2 text-sm text-amber-800">Empty categories: {emptyCategories.map((c) => c.label).join(", ")}</p>
          ) : null}
          <Link className="mt-2 inline-block text-sm underline" href={`/clients/${slug}/facts`}>Open Source of Truth</Link>
        </Card>
        <Card title="Integration status" className="lg:col-span-2">
          <Table head={["System", "Mode", "Status", "Account", "Verified"]}>
            {d.integrations.map((i) => (
              <tr key={i.system}>
                <td className="py-2 pr-4 font-medium capitalize">{i.system}</td>
                <td className="py-2 pr-4">{i.mode}</td>
                <td className="py-2 pr-4"><Chip value={i.status} /></td>
                <td className="py-2 pr-4 text-neutral-600">{i.externalAccountName ?? "—"}<br /><span className="text-xs">{i.scopeNote}</span></td>
                <td className="py-2 pr-4">{i.lastVerifiedAt ? fmtDate(i.lastVerifiedAt) : "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Missing inputs and open dependencies" className="lg:col-span-3">
          {d.missingTasks.length === 0 ? (
            <Empty>No open client dependencies.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.missingTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span>
                    {t.title}
                    {t.clickupTaskId ? (
                      <a className="ml-2 text-xs text-neutral-500 underline" href={`https://app.clickup.com/t/${t.clickupTaskId}`}>ClickUp</a>
                    ) : null}
                  </span>
                  <Chip value={t.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
