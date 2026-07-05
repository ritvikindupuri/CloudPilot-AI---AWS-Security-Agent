import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * AES-256-GCM Credential Vault
 * 
 * Replaces client-side XOR encryption with proper AES-256-GCM.
 * Key derivation: PBKDF2 from SUPABASE_SERVICE_ROLE_KEY + user_id salt.
 * All encryption/decryption happens server-side — raw keys never persist client-side.
 */

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

async function deriveKey(userId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SERVICE_ROLE_KEY),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(`cloudpilot-vault-${userId}`),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptValue(plaintext: string, userId: string): Promise<string> {
  const key = await deriveKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  // Format: base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptValue(encryptedB64: string, userId: string): Promise<string> {
  const key = await deriveKey(userId);
  const combined = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action;

    if (action === "encrypt_and_store") {
      const { accessKeyId, secretAccessKey, sessionToken, region, label, accountId, notificationEmail, scanMode, credentialMethod, roleArn } = body;
      
      if (!accessKeyId || !secretAccessKey) {
        return new Response(JSON.stringify({ error: "accessKeyId and secretAccessKey are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const encAccessKey = await encryptValue(accessKeyId, user.id);
      const encSecretKey = await encryptValue(secretAccessKey, user.id);
      const encSessionToken = sessionToken ? await encryptValue(sessionToken, user.id) : null;

      const { error: upsertErr } = await supabaseAdmin
        .from("stored_aws_credentials")
        .upsert({
          user_id: user.id,
          label: label || "Default",
          region: region || "us-east-1",
          encrypted_access_key_id: encAccessKey,
          encrypted_secret_access_key: encSecretKey,
          encrypted_session_token: encSessionToken,
          credential_method: credentialMethod || "access_key",
          role_arn: roleArn || null,
          account_id: accountId || null,
          notification_email: notificationEmail || null,
          guardian_enabled: true,
          scan_mode: scanMode || "all",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,label" });

      if (upsertErr) {
        return new Response(JSON.stringify({ error: `Storage failed: ${upsertErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, encryption: "AES-256-GCM" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "decrypt") {
      // Internal use only — called by guardian-scheduler with service role
      const { credentialId } = body;
      const { data: cred, error: fetchErr } = await supabaseAdmin
        .from("stored_aws_credentials")
        .select("*")
        .eq("id", credentialId)
        .single();

      if (fetchErr || !cred) {
        return new Response(JSON.stringify({ error: "Credential not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accessKeyId = await decryptValue(cred.encrypted_access_key_id, cred.user_id);
      const secretAccessKey = await decryptValue(cred.encrypted_secret_access_key, cred.user_id);
      const sessionToken = cred.encrypted_session_token
        ? await decryptValue(cred.encrypted_session_token, cred.user_id)
        : undefined;

      return new Response(JSON.stringify({
        accessKeyId,
        secretAccessKey,
        sessionToken,
        region: cred.region,
        userId: cred.user_id,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Vault operation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) {
  serve(handler);
}
