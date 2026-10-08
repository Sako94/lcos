import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "./integrations/secrets";

/**
 * Single entry point for model calls. The caller passes ONLY approved facts and SOP text;
 * credentials and raw documents never go in. When no key is configured the caller's
 * deterministic fallback is used, and the run records which path was taken.
 */
export type Draft = { text: string; model: string; usedModel: boolean };

export async function draft(system: string, user: string, maxTokens = 1500): Promise<Draft> {
  const key = anthropicKey();
  const model = process.env.AGENT_MODEL ?? "claude-sonnet-4-5";
  if (!key) return { text: "", model: "none", usedModel: false };
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
  return { text, model, usedModel: true };
}
