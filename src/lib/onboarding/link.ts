import "server-only";
import { withClientLink } from "@/lib/db";
import { QUESTION_BY_KEY, SECTION_BY_QUESTION, type AnswerValue } from "./questions";

export type LinkForm = {
  id: string;
  status: "sent" | "in_progress" | "submitted" | "reviewed" | "revoked";
  expiresAt: Date;
  expired: boolean;
  respondentName: string | null;
  submittedAt: Date | null;
  submittedByName: string | null;
  clientName: string;
};

const TOKEN_RE = /^[0-9a-f]{48}$/;

/** Load the form behind a private link, marking it opened. Returns null for an unknown token. */
export async function loadLinkForm(token: string): Promise<{ form: LinkForm; answers: Record<string, AnswerValue> } | null> {
  if (!TOKEN_RE.test(token)) return null;
  return withClientLink(async (tx) => {
    const rows = await tx<LinkForm[]>`
      select f.id, f.status, f.expires_at, f.expires_at <= now() as expired, f.respondent_name, f.submitted_at, f.submitted_by_name, c.name as client_name
      from public.onboarding_forms f join public.clients c on c.id = f.client_id
      where f.token = ${token}`;
    const form = rows[0];
    if (!form) return null;
    if (form.status !== "revoked") await tx`select app.onboarding_open(${token})`;
    const ans = await tx<{ questionKey: string; value: AnswerValue }[]>`
      select question_key, value from public.onboarding_answers where form_id = ${form.id}`;
    return { form, answers: Object.fromEntries(ans.map((a) => [a.questionKey, a.value])) };
  });
}

/** Check an answer against its question before it reaches the database. Returns an error message or null. */
export function validateAnswer(questionKey: string, value: unknown): string | null {
  const q = QUESTION_BY_KEY.get(questionKey);
  if (!q) return "Unknown question";
  if (q.type === "multi") {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !q.options!.includes(v))) return "Pick from the listed options";
    return null;
  }
  if (typeof value !== "string") return "Answer must be text";
  if (q.type === "single" && value !== "" && !q.options!.includes(value)) return "Pick one of the listed options";
  if (value.length > (q.type === "short" ? 500 : 8000)) return "That answer is too long";
  return null;
}

export async function saveLinkAnswer(token: string, questionKey: string, value: AnswerValue) {
  const section = SECTION_BY_QUESTION.get(questionKey)!;
  await withClientLink((tx) => tx`select app.onboarding_save(${token}, ${section}, ${questionKey}, ${tx.json(value)})`);
}

export async function submitLink(token: string, name: string) {
  await withClientLink((tx) => tx`select app.onboarding_submit(${token}, ${name})`);
}

export function dbMessage(e: unknown) {
  return e instanceof Error ? e.message.replace(/^.*?ERROR:\s*/, "") : String(e);
}
