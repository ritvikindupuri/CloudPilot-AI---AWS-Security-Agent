import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { getCorsHeaders } from "../_shared/cors.ts";
import { encryptValue, decryptAndMaybeReencrypt, isLegacyKeysEnabled } from "../_shared/vault-crypto.ts";
import { requireServiceRole } from "../_shared/internal-auth.ts";
import { GENERIC_ERRORS, logInternalError } from "../_shared/generic-error.ts";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

export async function decryptValue(encryptedB64: string, userId: string): Promise<string> {
  const result = await decryptAndMaybeReencrypt(encryptedB64, userId);
  return result.plaintext;
}

export const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);
  
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json();
    const action = body.action;

    let user: { id: string } | null = null;
    if (action === "decrypt") {
      const serviceAuth = requireServiceRole(req, SERVICE_ROLE_KEY, corsHeaders, "aws-credential-vault");
      if (serviceAuth) return serviceAuth;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: GENERIC_ERRORS.unauthorized }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data, error: authErr } = await supabaseAdmin.auth.getUser(token);
      if (authErr || !data.user) {
        return new Response(JSON.stringify({ error: GENERIC_ERRORS.unauthorized }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = data.user;
    }

    if (action === "encrypt_and_store") {
      if (!user) {
        return new Response(JSON.stringify({ error: GENERIC_ERRORS.unauthorized }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isLegacyKeysEnabled()) {
        return new Response(JSON.stringify({ error: GENERIC_ERRORS.legacyKeysDisabled }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { accessKeyId, secretAccessKey, sessionToken, region, label, accountId, notificationEmail, scanMode, credentialMethod, roleArn } = body;
      
      if (!accessKeyId || !secretAccessKey) {
        return new Response(JSON.stringify({ error: GENERIC_ERRORS.badRequest }), {
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
          encryption_key_version: "v2",
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,label" });

      if (upsertErr) {
        logInternalError("aws-credential-vault", upsertErr);
        return new Response(JSON.stringify({ error: GENERIC_ERRORS.internal }), {
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
      const serviceAuth = requireServiceRole(req, SERVICE_ROLE_KEY, corsHeaders, "aws-credential-vault");
      if (serviceAuth) return serviceAuth;
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
    logInternalError("aws-credential-vault", err);
    return new Response(JSON.stringify({ error: GENERIC_ERRORS.vaultUnavailable }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

if (import.meta.main) {
  serve(handler);
}
