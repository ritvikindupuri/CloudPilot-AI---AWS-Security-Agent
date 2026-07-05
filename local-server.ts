import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

// Initialize SQLite database
const db = new DB("cloudpilot.db");

// Dynamic schema helper: ensures tables and columns exist on-the-fly
function ensureTableAndColumns(tableName: string, sampleObject?: any, url?: URL) {
  // 1. Create table if it doesn't exist
  db.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT)`);

  const keysToAdd = new Set<string>();

  if (sampleObject) {
    for (const key of Object.keys(sampleObject)) {
      keysToAdd.add(key);
    }
  }

  if (url) {
    for (const [key, value] of url.searchParams.entries()) {
      if (key === "select" || key === "limit" || key === "order" || key === "offset") continue;
      keysToAdd.add(key);
    }
  }

  if (keysToAdd.size > 0) {
    // 2. Get existing columns
    const info = [...db.query(`PRAGMA table_info(${tableName})`)];
    const existingColumns = new Set(info.map(row => row[1]));

    // 3. Add any missing columns dynamically as TEXT
    for (const key of keysToAdd) {
      if (!existingColumns.has(key)) {
        console.log(`[CloudPilot SQLite] Dynamic schema: adding column '${key}' to table '${tableName}'`);
        try {
          db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${key} TEXT`);
        } catch (err) {
          console.warn(`[CloudPilot SQLite] Warning adding column '${key}':`, err);
        }
      }
    }
  }
}

// Pre-create auth table
ensureTableAndColumns("registered_users", { email: "", password: "" });

console.log("[CloudPilot SQLite] SQLite engine active.");

// Parse .env file locally
const envVars: Record<string, string> = {};
try {
  const content = Deno.readTextFileSync(".env");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      let value = parts.slice(1).join("=").trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      envVars[key] = value;
    }
  }
} catch {
  console.log("No .env file found or failed to read. Falling back to system environment variables.");
}

// Inject variables into Deno env first before importing any module
for (const [key, value] of Object.entries(envVars)) {
  Deno.env.set(key, value);
}

// Set required Supabase env variables to loopback internally
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_ANON_KEY", Deno.env.get("SUPABASE_ANON_KEY") || "mock-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "mock-service-role-key");

// Import handlers dynamically so they execute AFTER environment variables are set
console.log("[CloudPilot Local Gateway] Loading modules...");
const { handler: awsAgent } = await import("./supabase/functions/aws-agent/index.ts");
const { handler: awsAgentTools } = await import("./supabase/functions/aws-agent-tools/index.ts");
const { handler: awsAgentScanner } = await import("./supabase/functions/aws-agent-scanner/index.ts");
const { handler: awsAgentOps } = await import("./supabase/functions/aws-agent-ops/index.ts");
const { handler: awsExecutor } = await import("./supabase/functions/aws-executor/index.ts");
const { handler: awsExchange } = await import("./supabase/functions/aws-exchange-credentials/index.ts");
const { handler: awsCredentialVault } = await import("./supabase/functions/aws-credential-vault/index.ts");
const { handler: webhookNotify } = await import("./supabase/functions/webhook-notify/index.ts");
console.log("[CloudPilot Local Gateway] Modules successfully loaded.");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

function parseFilters(url: URL): { where: string; params: any[]; limit: string; order: string } {
  const whereClauses: string[] = [];
  const params: any[] = [];
  let limit = "";
  let order = "";

  for (const [key, value] of url.searchParams.entries()) {
    if (key === "select") continue;
    if (key === "limit") {
      limit = `LIMIT ${parseInt(value)}`;
      continue;
    }
    if (key === "order") {
      const parts = value.split(".");
      const col = parts[0];
      const dir = (parts[1] || "asc").toUpperCase();
      order = `ORDER BY ${col} ${dir}`;
      continue;
    }
    
    if (value.startsWith("eq.")) {
      whereClauses.push(`${key} = ?`);
      params.push(value.slice(3));
    } else if (value.startsWith("gte.")) {
      whereClauses.push(`${key} >= ?`);
      params.push(value.slice(4));
    } else if (value.startsWith("in.")) {
      const match = value.match(/\(([^)]+)\)/);
      if (match) {
        const list = match[1].split(",");
        const placeholders = list.map(() => "?").join(",");
        whereClauses.push(`${key} IN (${placeholders})`);
        params.push(...list);
      }
    }
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return { where, params, limit, order };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // ── AUTH ENDPOINTS ────────────────────────────────────────────────────────
    if (path.startsWith("/auth/v1/")) {
      const authAction = path.slice("/auth/v1/".length);
      console.log(`[CloudPilot SQL Auth] ${req.method} ${path}`);

      const getSessionPayload = (user: any) => {
        const expires_in = 3600;
        return {
          access_token: `mock-access-token-${user.id}`,
          token_type: "bearer",
          expires_in,
          expires_at: Math.floor(Date.now() / 1000) + expires_in,
          refresh_token: `mock-refresh-token-${user.id}`,
          user: {
            id: user.id,
            email: user.email,
            aud: "authenticated",
            role: "authenticated",
            email_confirmed_at: user.created_at,
            confirmed_at: user.created_at,
            last_sign_in_at: new Date().toISOString(),
          }
        };
      };

      if (authAction === "signup") {
        const { email, password } = await req.json();
        const existing = [...db.queryEntries("SELECT * FROM registered_users WHERE email = ?", [email.trim()])];
        if (existing.length > 0) {
          return new Response(JSON.stringify({ error: { message: "User already exists", status: 400 } }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const user = {
          id: crypto.randomUUID(),
          email: email.trim(),
          password,
          created_at: new Date().toISOString()
        };
        db.query("INSERT INTO registered_users (id, email, password, created_at) VALUES (?, ?, ?, ?)", [
          user.id, user.email, user.password, user.created_at
        ]);
        return new Response(JSON.stringify(getSessionPayload(user)), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (authAction === "token") {
        const grantType = url.searchParams.get("grant_type");
        if (grantType === "password") {
          const { email, password } = await req.json();
          const matched = [...db.queryEntries("SELECT * FROM registered_users WHERE email = ?", [email.trim()])];
          if (matched.length === 0 || matched[0].password !== password) {
            return new Response(JSON.stringify({ error: { message: "Invalid login credentials", status: 400 } }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          return new Response(JSON.stringify(getSessionPayload(matched[0])), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      if (authAction === "user") {
        const authHeader = req.headers.get("Authorization") || "";
        const token = authHeader.replace("Bearer ", "");
        const matchToken = token.match(/^mock-access-token-(.+)$/);
        const userId = matchToken ? matchToken[1] : null;

        if (!userId) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const matched = [...db.queryEntries("SELECT * FROM registered_users WHERE id = ?", [userId])];
        if (matched.length === 0) {
          return new Response(JSON.stringify({ error: "User not found" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({
          id: matched[0].id,
          email: matched[0].email,
          aud: "authenticated",
          role: "authenticated",
          email_confirmed_at: matched[0].created_at,
          confirmed_at: matched[0].created_at,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (authAction === "logout") {
        return new Response(JSON.stringify({}), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ── DATABASE REST ENDPOINTS (PostgREST Emulator) ─────────────────────────
    if (path.startsWith("/rest/v1/")) {
      const tableName = path.slice("/rest/v1/".length);
      console.log(`[CloudPilot SQL Database] ${req.method} ${path}`);

      // GET: Query rows
      if (req.method === "GET") {
        ensureTableAndColumns(tableName, null, url);
        const { where, params, limit, order } = parseFilters(url);
        const queryStr = `SELECT * FROM ${tableName} ${where} ${order} ${limit}`;
        const rows = [...db.queryEntries(queryStr, params)];

        const acceptHeader = req.headers.get("accept") || "";
        const wantSingle = acceptHeader.includes("application/vnd.pgrst.object+json");

        if (wantSingle) {
          return new Response(JSON.stringify(rows[0] || null), {
            status: rows[0] ? 200 : 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify(rows), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // POST: Insert rows
      if (req.method === "POST") {
        const body = await req.json();
        const list = Array.isArray(body) ? body : [body];
        const results: any[] = [];

        // Check columns based on sample payload
        if (list.length > 0) {
          ensureTableAndColumns(tableName, list[0], url);
        }

        for (const item of list) {
          const id = item.id || crypto.randomUUID();
          const created_at = item.created_at || new Date().toISOString();
          const updated_at = item.updated_at || new Date().toISOString();
          const merged = { id, created_at, updated_at, ...item };

          const keys = Object.keys(merged);
          const placeholders = keys.map(() => "?").join(",");
          const insertSql = `INSERT INTO ${tableName} (${keys.join(",")}) VALUES (${placeholders})`;

          db.query(insertSql, Object.values(merged));
          results.push(merged);
        }

        return new Response(JSON.stringify(Array.isArray(body) ? results : results[0]), {
          status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // PATCH: Update rows
      if (req.method === "PATCH") {
        const body = await req.json();
        ensureTableAndColumns(tableName, body, url);
        
        const { where, params } = parseFilters(url);
        const updates: string[] = [];
        const updateParams: any[] = [];

        for (const [key, val] of Object.entries(body)) {
          if (key === "id" || key === "created_at") continue;
          updates.push(`${key} = ?`);
          updateParams.push(val);
        }

        updates.push(`updated_at = ?`);
        updateParams.push(new Date().toISOString());

        const updateSql = `UPDATE ${tableName} SET ${updates.join(", ")} ${where}`;
        db.query(updateSql, [...updateParams, ...params]);

        return new Response(JSON.stringify({}), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // DELETE: Delete rows
      if (req.method === "DELETE") {
        ensureTableAndColumns(tableName, null, url);
        const { where, params } = parseFilters(url);
        const deleteSql = `DELETE FROM ${tableName} ${where}`;
        db.query(deleteSql, params);

        return new Response(JSON.stringify({}), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ── Edge Functions ────────────────────────────────────────────────────────
    console.log(`[CloudPilot Deno Gateway] ${req.method} ${path}`);

    let response: Response;

    if (path.endsWith("/aws-agent")) {
      response = await awsAgent(req);
    } else if (path.endsWith("/aws-agent-tools")) {
      response = await awsAgentTools(req);
    } else if (path.endsWith("/aws-agent-scanner")) {
      response = await awsAgentScanner(req);
    } else if (path.endsWith("/aws-agent-ops")) {
      response = await awsAgentOps(req);
    } else if (path.endsWith("/aws-executor")) {
      response = await awsExecutor(req);
    } else if (path.endsWith("/aws-exchange-credentials")) {
      response = await awsExchange(req);
    } else if (path.endsWith("/aws-credential-vault")) {
      response = await awsCredentialVault(req);
    } else if (path.endsWith("/webhook-notify")) {
      response = await webhookNotify(req);
    } else {
      response = new Response(JSON.stringify({ error: `Not found: ${path}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (err: any) {
    console.error(`[CloudPilot Deno Gateway] Error handling ${path}:`, err);
    return new Response(JSON.stringify({ error: err.message || "Internal gateway error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}, { port: 54321 });

console.log("=========================================");
console.log("CloudPilot Local Deno Gateway active on:");
console.log("👉 http://localhost:54321");
console.log("=========================================");
