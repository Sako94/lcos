import "server-only";

/**
 * Credentials are read from the environment only, keyed by client slug.
 * They are never stored in the database, never passed into prompts, and never logged.
 * Supabase deployments can map these to Vault secrets; the shape stays the same.
 */
export function klaviyoKey(slug: string): string | null {
  return process.env[`KLAVIYO_API_KEY__${slug}`] ?? null;
}

export function clickupToken(): string | null {
  return process.env.CLICKUP_API_TOKEN ?? null;
}

export function clickupListId(slug: string): string | null {
  return process.env[`CLICKUP_LIST_ID__${slug}`] ?? null;
}

export function anthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}
