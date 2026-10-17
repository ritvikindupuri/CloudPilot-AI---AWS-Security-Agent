/**
 * AES-256-GCM vault using a dedicated CREDENTIAL_VAULT_KEY.
 * Versioned ciphertext supports decrypt-with-old / encrypt-with-new migration
 * off the legacy service-role-derived key.
 *
 * Format: v2:<base64(iv+ciphertext)>  (dedicated key)
 *         v1:<base64(iv+ciphertext)>  (legacy service-role key — decrypt only)
 *         <base64>                    (unversioned legacy)
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const VAULT_KEY_ENV = "CREDENTIAL_VAULT_KEY";
export const VAULT_KEY_PREV_ENV = "CREDENTIAL_VAULT_KEY_PREVIOUS";
export const CURRENT_VAULT_VERSION = "v2";

function requireVaultKey(env: { get(key: string): string | undefined } = Deno.env): string {
  const key = env.get(VAULT_KEY_ENV);
  if (!key || key.trim().length < 32) {
    throw new Error("CREDENTIAL_VAULT_KEY is missing or too short (need >= 32 characters). Vault is fail-closed.");
  }
  return key;
}

async function deriveKey(keyMaterial: string, userId: string): Promise<CryptoKey> {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(`cloudpilot-vault-${userId}`),
      iterations: 100000,
      hash: "SHA-256",
    },
    imported,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseVersioned(encrypted: string): { version: string; payload: string } {
  const match = encrypted.match(/^(v\d+):([\s\S]+)$/);
  if (match) return { version: match[1], payload: match[2] };
  return { version: "v1", payload: encrypted };
}

async function decryptWithMaterial(encryptedB64: string, userId: string, material: string): Promise<string> {
  const key = await deriveKey(material, userId);
  const combined = Uint8Array.from(atob(encryptedB64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return decoder.decode(decrypted);
}

export async function encryptValue(
  plaintext: string,
  userId: string,
  env: { get(key: string): string | undefined } = Deno.env,
): Promise<string> {
  const material = requireVaultKey(env);
  const key = await deriveKey(material, userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  const b64 = btoa(String.fromCharCode(...combined));
  return `${CURRENT_VAULT_VERSION}:${b64}`;
}

export interface DecryptResult {
  plaintext: string;
  migrated: boolean;
  version: string;
}

export async function decryptValue(
  encrypted: string,
  userId: string,
  env: { get(key: string): string | undefined } = Deno.env,
): Promise<DecryptResult> {
  const { version, payload } = parseVersioned(encrypted);
  const current = env.get(VAULT_KEY_ENV);
  const previous = env.get(VAULT_KEY_PREV_ENV);
  const legacy = env.get("SUPABASE_SERVICE_ROLE_KEY");

  const attempts: Array<{ material: string; label: string }> = [];
  if (current && current.trim().length >= 32) attempts.push({ material: current, label: "v2" });
  if (previous && previous.trim().length >= 32) attempts.push({ material: previous, label: "v2-prev" });
  if (legacy) attempts.push({ material: legacy, label: "v1" });

  if (attempts.length === 0) {
    throw new Error("CREDENTIAL_VAULT_KEY is missing. Vault is fail-closed.");
  }

  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      const plaintext = await decryptWithMaterial(payload, userId, attempt.material);
      const migrated = version !== CURRENT_VAULT_VERSION || attempt.label !== "v2";
      return { plaintext, migrated, version };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Vault decrypt failed");
}

export async function decryptAndMaybeReencrypt(
  encrypted: string,
  userId: string,
  env: { get(key: string): string | undefined } = Deno.env,
): Promise<{ plaintext: string; ciphertext: string; rotated: boolean }> {
  const result = await decryptValue(encrypted, userId, env);
  if (!result.migrated) {
    return { plaintext: result.plaintext, ciphertext: encrypted, rotated: false };
  }
  const ciphertext = await encryptValue(result.plaintext, userId, env);
  return { plaintext: result.plaintext, ciphertext, rotated: true };
}

export function isLegacyKeysEnabled(env: { get(key: string): string | undefined } = Deno.env): boolean {
  const flag = (env.get("ENABLE_LEGACY_ACCESS_KEYS") || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}
