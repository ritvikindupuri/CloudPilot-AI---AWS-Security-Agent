/**
 * Resolve per-user AWS credentials on the server.
 * Never accepts browser-supplied secrets unless ENABLE_LEGACY_ACCESS_KEYS is on.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { decryptAndMaybeReencrypt, encryptValue, isLegacyKeysEnabled } from "./vault-crypto.ts";
import { assumeCustomerRole, awsConfigFromSession, generateExternalId } from "./sts-credentials.ts";

export interface StoredConnection {
  id: string;
  user_id: string;
  region: string;
  credential_method: string;
  role_arn: string | null;
  account_id: string | null;
  encrypted_access_key_id: string | null;
  encrypted_secret_access_key: string | null;
  encrypted_session_token: string | null;
  encrypted_external_id: string | null;
  encryption_key_version: string | null;
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase admin env is missing");
  return createClient(url, key);
}

export async function loadStoredConnection(userId: string, credentialId?: string): Promise<StoredConnection | null> {
  const supabase = adminClient();
  let query = supabase.from("stored_aws_credentials").select("*").eq("user_id", userId);
  if (credentialId) query = query.eq("id", credentialId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return data as StoredConnection;
}

export async function resolveAwsConfigForUser(opts: {
  userId: string;
  credentialId?: string;
  bodyCredentials?: Record<string, unknown> | null;
}): Promise<{ awsConfig: Record<string, unknown>; accountId?: string; connectionId?: string }> {
  if (opts.bodyCredentials && isLegacyKeysEnabled()) {
    const c = opts.bodyCredentials;
    const accessKeyId = typeof c.accessKeyId === "string" ? c.accessKeyId : "";
    const secretAccessKey = typeof c.secretAccessKey === "string" ? c.secretAccessKey : "";
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("legacy-keys-incomplete");
    }
    return {
      awsConfig: {
        region: typeof c.region === "string" ? c.region : "us-east-1",
        credentials: {
          accessKeyId,
          secretAccessKey,
          ...(typeof c.sessionToken === "string" && c.sessionToken ? { sessionToken: c.sessionToken } : {}),
        },
      },
    };
  }

  const stored = await loadStoredConnection(opts.userId, opts.credentialId);
  if (!stored) throw new Error("no-stored-connection");

  if (stored.credential_method === "assume_role" && stored.role_arn && stored.encrypted_external_id) {
    const ext = await decryptAndMaybeReencrypt(stored.encrypted_external_id, stored.user_id);
    if (ext.rotated) {
      await adminClient().from("stored_aws_credentials").update({
        encrypted_external_id: ext.ciphertext,
        encryption_key_version: "v2",
        updated_at: new Date().toISOString(),
      }).eq("id", stored.id);
    }
    const session = await assumeCustomerRole({
      roleArn: stored.role_arn,
      externalId: ext.plaintext,
      region: stored.region || "us-east-1",
    });
    return {
      awsConfig: awsConfigFromSession(session),
      accountId: session.identity.account,
      connectionId: stored.id,
    };
  }

  if (!isLegacyKeysEnabled()) {
    throw new Error("legacy-keys-disabled");
  }
  if (!stored.encrypted_access_key_id || !stored.encrypted_secret_access_key) {
    throw new Error("no-stored-connection");
  }
  const access = await decryptAndMaybeReencrypt(stored.encrypted_access_key_id, stored.user_id);
  const secret = await decryptAndMaybeReencrypt(stored.encrypted_secret_access_key, stored.user_id);
  let sessionToken: string | undefined;
  if (stored.encrypted_session_token) {
    const tok = await decryptAndMaybeReencrypt(stored.encrypted_session_token, stored.user_id);
    sessionToken = tok.plaintext;
  }
  if (access.rotated || secret.rotated) {
    await adminClient().from("stored_aws_credentials").update({
      encrypted_access_key_id: access.ciphertext,
      encrypted_secret_access_key: secret.ciphertext,
      encryption_key_version: "v2",
      updated_at: new Date().toISOString(),
    }).eq("id", stored.id);
  }
  return {
    awsConfig: {
      region: stored.region || "us-east-1",
      credentials: {
        accessKeyId: access.plaintext,
        secretAccessKey: secret.plaintext,
        ...(sessionToken ? { sessionToken } : {}),
      },
    },
    accountId: stored.account_id || undefined,
    connectionId: stored.id,
  };
}

export async function ensureExternalId(userId: string, region: string): Promise<{ externalId: string; credentialId: string }> {
  const supabase = adminClient();
  const existing = await loadStoredConnection(userId);
  if (existing?.encrypted_external_id) {
    const ext = await decryptAndMaybeReencrypt(existing.encrypted_external_id, userId);
    return { externalId: ext.plaintext, credentialId: existing.id };
  }
  const externalId = generateExternalId();
  const encrypted = await encryptValue(externalId, userId);
  if (existing) {
    const { error } = await supabase.from("stored_aws_credentials").update({
      encrypted_external_id: encrypted,
      encryption_key_version: "v2",
      region: region || existing.region,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (error) throw new Error("Failed to store ExternalId");
    return { externalId, credentialId: existing.id };
  }
  const { data, error } = await supabase.from("stored_aws_credentials").insert({
    user_id: userId,
    label: "Default",
    region: region || "us-east-1",
    credential_method: "assume_role",
    encrypted_external_id: encrypted,
    encryption_key_version: "v2",
  }).select("id").single();
  if (error || !data) throw new Error("Failed to store ExternalId");
  return { externalId, credentialId: data.id };
}
