import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { clientRole, getClient } from "@/lib/clients";
import { Card, Chip, Empty, PageHeader, Table, btnSecondary, input } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { createMeeting } from "./actions";

export default async function MeetingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const client = await getClient(user, slug);
  const d = await withUser(user.id, async (tx) => {
    const role = await clientRole(tx, client.id);
    const meetings = await tx<{ id: string; scheduledAt: string; status: string; decisions: number; open: number }[]>`
      select m.id, m.scheduled_at, m.status,
        (select count(*)::int from public.decisions d where d.meeting_id = m.id) as decisions,
        (select count(*)::int from public.commitments c where c.meeting_id = m.id and c.status = 'open') as open
      from public.meetings m where m.client_id = ${client.id} order by m.scheduled_at desc`;
    return { role, meetings };
  });
  const canEdit = d.role === "admin" || d.role === "account_lead";
  return (
    <>
      <PageHeader title={`${client.name} · Meetings`} subtitle="Biweekly: pre-read 48 hours before, decisions and commitments within 24 hours after (SOP 9)." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Meetings">
          {d.meetings.length === 0 ? <Empty>No meetings yet.</Empty> : (
            <Table head={["When", "Status", "Decisions", "Open commitments"]}>
              {d.meetings.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-4"><Link className="underline" href={`/clients/${slug}/meetings/${m.id}`}>{new Date(m.scheduledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</Link></td>
                  <td className="py-2 pr-4"><Chip value={m.status} /></td>
                  <td className="py-2 pr-4">{m.decisions}</td>
                  <td className="py-2 pr-4">{m.open}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {canEdit ? (
          <Card title="Schedule a meeting">
            <ActionForm action={createMeeting.bind(null, slug)} className="space-y-2">
              <input type="hidden" name="client_id" value={client.id} />
              <input type="datetime-local" name="scheduled_at" className={input} required />
              <button className={btnSecondary}>Add meeting</button>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
