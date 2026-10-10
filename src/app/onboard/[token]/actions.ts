"use server";

import { revalidatePath } from "next/cache";
import { dbMessage, loadLinkForm, saveLinkAnswer, submitLink, validateAnswer } from "@/lib/onboarding/link";
import { missingRequired, type AnswerValue } from "@/lib/onboarding/questions";

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveAnswer(token: string, questionKey: string, value: AnswerValue): Promise<SaveResult> {
  const err = validateAnswer(questionKey, value);
  if (err) return { ok: false, error: err };
  try {
    await saveLinkAnswer(token, questionKey, value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: dbMessage(e) };
  }
}

export async function submitQuestionnaire(token: string, name: string): Promise<SaveResult> {
  const loaded = await loadLinkForm(token);
  if (!loaded) return { ok: false, error: "This link isn't valid." };
  const missing = missingRequired(loaded.answers);
  if (missing.length) return { ok: false, error: `Please answer the required questions first (${missing.length} left).` };
  try {
    await submitLink(token, name);
    revalidatePath(`/onboard/${token}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: dbMessage(e) };
  }
}
