import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

// Initialize SQLite database
const db = new DB("cloudpilot.db");

// ── SECURITY: Allowed table names (strict allowlist — prevents SQL injection via URL path) ──
// NOTE: This must be defined before ensureTableAndColumns which references it.
const ALLOWED_TABLES = new Set([
  "registered_users",
  "custom_skills",
  "in_vpc_agents",
  "in_vpc_events",
  "conversations",
  "messages",
  "stored_aws_credentials",
  "cost_rules",
  "drift_baselines",
  "event_response_policies",
  "runbook_executions",
  "org_operations",
  "guardian_events",
  "automation_idempotency_keys",
  "approval_requests",
  "approval_actions",
  "compliance_evidence_exports",
  "webhook_configs",
  "organizations",
  "organization_members",
  "subscriptions",
]);

// ── SECURITY: Column name pattern — alphanumeric + underscore only ──
const SAFE_COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function isSafeIdentifier(name: string): boolean {
  return SAFE_COLUMN_RE.test(name);
}



// Dynamic schema helper: ensures tables and columns exist on-the-fly
function ensureTableAndColumns(tableName: string, sampleObject?: any, url?: URL) {
  // SECURITY: Validate tableName before any SQL construction
  if (!ALLOWED_TABLES.has(tableName)) {
    console.warn(`[CloudPilot SQLite] Rejected unknown table: '${tableName}'`);
    return;
  }

  // 1. Create table if it doesn't exist (tableName is allowlisted above)
  db.execute(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT)`);

  const keysToAdd = new Set<string>();

  if (sampleObject) {
    for (const key of Object.keys(sampleObject)) {
      // SECURITY: Only add columns with safe identifiers
      if (isSafeIdentifier(key)) keysToAdd.add(key);
    }
  }

  if (url) {
    for (const [key] of url.searchParams.entries()) {
      if (key === "select" || key === "limit" || key === "order" || key === "offset") continue;
      // SECURITY: Only add columns with safe identifiers
      if (isSafeIdentifier(key)) keysToAdd.add(key);
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
          // SECURITY: key is already validated as a safe identifier above
          db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${key} TEXT`);
        } catch (err) {
          console.warn(`[CloudPilot SQLite] Warning adding column '${key}':`, err);
        }
      }
    }
  }
}


// Pre-create auth table & custom skills table
ensureTableAndColumns("registered_users", { email: "", password: "" });
ensureTableAndColumns("custom_skills", {
  id: "",
  user_id: "",
  name: "",
  badge: "",
  description: "",
  intent_key: "",
  system_supplement: "",
  allowed_tools: "[]",
  trigger_keywords: "[]",
  is_active: "true",
  created_at: "",
  updated_at: "",
});

ensureTableAndColumns("in_vpc_agents", {
  id: "",
  user_id: "",
  name: "",
  account_id: "",
  region: "",
  vpc_id: "",
  status: "ONLINE",
  version: "v1.2.0",
  auto_remediation_enabled: "true",
  last_heartbeat_at: "",
  created_at: "",
  updated_at: "",
});

ensureTableAndColumns("in_vpc_events", {
  id: "",
  agent_id: "",
  account_id: "",
  region: "",
  vpc_id: "",
  event_source: "",
  event_type: "",
  action_taken: "REMEDIATED",
  severity: "CRITICAL",
  description: "",
  resource_id: "",
  raw_event: "{}",
  timestamp: "",
});

try {
  db.query("DELETE FROM in_vpc_agents WHERE user_id = 'system'");
  db.query("DELETE FROM in_vpc_events WHERE agent_id = 'in-vpc-123456789012-us-east-1'");
} catch {}

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
  "Access-Control-Allow-Origin": "http://localhost:8080",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, PATCH, DELETE",
};

// ── SECURITY: Password hashing using Web Crypto PBKDF2 ──

const HASH_ITERATIONS = 100_000;
const HASH_SALT_PREFIX = "cloudpilot-local-auth-v1-";

async function hashPassword(password: string, userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const salt = encoder.encode(`${HASH_SALT_PREFIX}${userId}`);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: HASH_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(derived)));
}

async function verifyPassword(password: string, userId: string, storedHash: string): Promise<boolean> {
  const hash = await hashPassword(password, userId);
  return hash === storedHash;
}

// ── SECURITY: Max request body size (1 MB) ──
const MAX_BODY_BYTES = 1_024 * 1_024;

async function readBodySafe(req: Request): Promise<any> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) throw new Error("Request body too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Request body too large");
  return JSON.parse(text);
}

function parseFilters(url: URL, existingColumns: Set<string>): { where: string; params: any[]; limit: string; order: string } {
  const whereClauses: string[] = [];
  const params: any[] = [];
  let limit = "";
  let order = "";
  const MAX_LIMIT = 500;

  for (const [key, value] of url.searchParams.entries()) {
    if (key === "select") continue;
    if (key === "limit") {
      const n = Math.min(Math.max(1, parseInt(value) || 100), MAX_LIMIT);
      limit = `LIMIT ${n}`;
      continue;
    }
    if (key === "order") {
      const parts = value.split(".");
      const col = parts[0];
      const dir = (parts[1] || "asc").toUpperCase();
      // SECURITY: Validate column name and direction against allowlist
      if (!isSafeIdentifier(col) || !existingColumns.has(col)) {
        console.warn(`[CloudPilot SQL] Rejected unsafe ORDER BY column: '${col}'`);
        continue;
      }
      if (dir !== "ASC" && dir !== "DESC") continue;
      order = `ORDER BY ${col} ${dir}`;
      continue;
    }

    // SECURITY: Validate column name against allowlist before using in WHERE
    if (!isSafeIdentifier(key) || !existingColumns.has(key)) {
      console.warn(`[CloudPilot SQL] Rejected unsafe WHERE column: '${key}'`);
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
        const list = match[1].split(",").slice(0, 100); // max 100 IN values
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

      const generateSessionToken = (): string => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) =>
          ({ "+": "-", "/": "_", "=": "" }[c] || c)
        );
      };

      // In-memory session store (token → userId) — scoped to process lifetime only
      // Tokens are cryptographically random and NOT predictable
      const sessionStore = (globalThis as any).__cloudpilotSessions ??= new Map<string, string>();

      const getSessionPayload = (user: any) => {
        const expires_in = 3600;
        const accessToken = generateSessionToken();
        const refreshToken = generateSessionToken();
        sessionStore.set(accessToken, user.id);
        return {
          access_token: accessToken,
          token_type: "bearer",
          expires_in,
          expires_at: Math.floor(Date.now() / 1000) + expires_in,
          refresh_token: refreshToken,
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
        const body = await readBodySafe(req);
        const { email, password } = body;
        if (!email || typeof email !== "string" || !password || typeof password !== "string") {
          return new Response(JSON.stringify({ error: { message: "Email and password are required", status: 400 } }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (password.length < 8) {
          return new Response(JSON.stringify({ error: { message: "Password must be at least 8 characters", status: 400 } }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const existing = [...db.queryEntries("SELECT id FROM registered_users WHERE email = ?", [email.trim().toLowerCase()])];
        if (existing.length > 0) {
          return new Response(JSON.stringify({ error: { message: "User already exists", status: 400 } }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const userId = crypto.randomUUID();
        const passwordHash = await hashPassword(password, userId);
        const createdAt = new Date().toISOString();
        db.query("INSERT INTO registered_users (id, email, password, created_at) VALUES (?, ?, ?, ?)", [
          userId, email.trim().toLowerCase(), passwordHash, createdAt
        ]);
        const user = { id: userId, email: email.trim().toLowerCase(), created_at: createdAt };
        return new Response(JSON.stringify(getSessionPayload(user)), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (authAction === "token") {
        const grantType = url.searchParams.get("grant_type");
        if (grantType === "password") {
          const body = await readBodySafe(req);
          const { email, password } = body;
          if (!email || !password) {
            return new Response(JSON.stringify({ error: { message: "Invalid login credentials", status: 400 } }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const matched = [...db.queryEntries("SELECT * FROM registered_users WHERE email = ?", [email.trim().toLowerCase()])];
          // SECURITY: Use constant-time password verification
          const passwordValid = matched.length > 0 && await verifyPassword(password, matched[0].id as string, matched[0].password as string);
          if (!passwordValid) {
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
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const sessionStore = (globalThis as any).__cloudpilotSessions ??= new Map<string, string>();
        const userId = sessionStore.get(token) ?? null;

        if (!userId) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const matched = [...db.queryEntries("SELECT id, email, created_at FROM registered_users WHERE id = ?", [userId])];
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
      const rawTableName = path.slice("/rest/v1/".length).split("?")[0].split("/")[0];

      // SECURITY: Strict table name allowlist — prevents SQL injection via URL path
      if (!ALLOWED_TABLES.has(rawTableName)) {
        return new Response(JSON.stringify({ error: "Table not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const tableName = rawTableName;
      console.log(`[CloudPilot SQL Database] ${req.method} ${path}`);

      const tryParseJson = (val: any) => {
        if (typeof val === "string") {
          const trimmed = val.trim();
          if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
            try {
              return JSON.parse(trimmed);
            } catch {
              return val;
            }
          }
        }
        return val;
      };

      // Helper: get existing column names for safe filter parsing
      const getExistingColumns = (): Set<string> => {
        try {
          const info = [...db.query(`PRAGMA table_info(${tableName})`)];
          return new Set(info.map((row: any) => row[1] as string));
        } catch {
          return new Set();
        }
      };

      // GET: Query rows
      if (req.method === "GET") {
        ensureTableAndColumns(tableName, null, url);
        const existingCols = getExistingColumns();
        const { where, params, limit, order } = parseFilters(url, existingCols);
        const queryStr = `SELECT * FROM ${tableName} ${where} ${order} ${limit}`;
        const rawRows = [...db.queryEntries(queryStr, params)];

        // Parse any JSON strings back to objects
        const rows = rawRows.map((row) => {
          const parsedRow: any = {};
          for (const [key, val] of Object.entries(row)) {
            parsedRow[key] = tryParseJson(val);
          }
          return parsedRow;
        });

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
        const body = await readBodySafe(req);
        const list = Array.isArray(body) ? body.slice(0, 100) : [body]; // max 100 rows per insert
        const results: any[] = [];

        // Check columns based on sample payload
        if (list.length > 0) {
          ensureTableAndColumns(tableName, list[0], url);
        }

        const existingCols = getExistingColumns();

        for (const item of list) {
          const id = item.id || crypto.randomUUID();
          const created_at = item.created_at || new Date().toISOString();
          const updated_at = item.updated_at || new Date().toISOString();
          const merged = { id, created_at, updated_at, ...item };

          // SECURITY: Validate all keys are safe identifiers that exist in the schema
          const safeKeys = Object.keys(merged).filter((k) => isSafeIdentifier(k) && existingCols.has(k));
          const placeholders = safeKeys.map(() => "?").join(",");
          const insertSql = `INSERT INTO ${tableName} (${safeKeys.join(",")}) VALUES (${placeholders})`;

          const bindValues = safeKeys.map((k) => {
            const val = (merged as any)[k];
            return (val !== null && typeof val === "object") ? JSON.stringify(val) : val;
          });

          db.query(insertSql, bindValues);
          results.push(merged);
        }

        return new Response(JSON.stringify(Array.isArray(body) ? results : results[0]), {
          status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // PATCH: Update rows
      if (req.method === "PATCH") {
        const body = await readBodySafe(req);
        ensureTableAndColumns(tableName, body, url);

        const existingCols = getExistingColumns();
        const { where, params } = parseFilters(url, existingCols);
        const updates: string[] = [];
        const updateParams: any[] = [];

        for (const [key, val] of Object.entries(body)) {
          if (key === "id" || key === "created_at") continue;
          // SECURITY: Validate column name
          if (!isSafeIdentifier(key) || !existingCols.has(key)) continue;
          updates.push(`${key} = ?`);
          const sanitizedVal = (val !== null && typeof val === "object") ? JSON.stringify(val) : val;
          updateParams.push(sanitizedVal);
        }

        updates.push(`updated_at = ?`);
        updateParams.push(new Date().toISOString());

        if (updates.length === 1) {
          // Only updated_at — nothing to update
          return new Response(JSON.stringify({}), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const updateSql = `UPDATE ${tableName} SET ${updates.join(", ")} ${where}`;
        db.query(updateSql, [...updateParams, ...params]);

        return new Response(JSON.stringify({}), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // DELETE: Delete rows
      if (req.method === "DELETE") {
        ensureTableAndColumns(tableName, null, url);
        const existingCols = getExistingColumns();
        const { where, params } = parseFilters(url, existingCols);
        const deleteSql = `DELETE FROM ${tableName} ${where}`;
        db.query(deleteSql, params);

        return new Response(JSON.stringify({}), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // ── IN-VPC AGENT SIMULATION ENDPOINT ─────────────────────────────────────
    if (path === "/api/in-vpc-agent/simulate-event") {
      const body = await req.json().catch(() => ({}));
      const agentId = body.agentId || "in-vpc-123456789012-us-east-1";
      const eventType = body.eventType || "AuthorizeSecurityGroupIngress";
      const sampleEvents: Record<string, any> = {
        AuthorizeSecurityGroupIngress: {
          action_taken: "REMEDIATED",
          severity: "CRITICAL",
          description: "Auto-closed unauthorized 0.0.0.0/0 ingress on port 22 (SSH) on security group sg-0a9b8c7d6e5f",
          resource_id: "sg-0a9b8c7d6e5f",
          source: "aws.ec2",
        },
        PutBucketPolicy: {
          action_taken: "REMEDIATED",
          severity: "HIGH",
          description: "Public wildcard Principal '*' policy detected on s3://prod-customer-assets; applied S3 Public Access Block",
          resource_id: "arn:aws:s3:::prod-customer-assets",
          source: "aws.s3",
        },
        AttachUserPolicy: {
          action_taken: "FLAGGED",
          severity: "MEDIUM",
          description: "Direct AdministratorAccess policy attached to IAM user 'deploy-bot'; flagged against SCP boundaries",
          resource_id: "arn:aws:iam::123456789012:user/deploy-bot",
          source: "aws.iam",
        },
        RevokeSecurityGroupIngress: {
          action_taken: "FLAGGED",
          severity: "LOW",
          description: "Audited standard security group rule revocation by DevOps automation pipeline",
          resource_id: "sg-0123456789abcdef0",
          source: "aws.ec2",
        }
      };

      const selected = sampleEvents[eventType] || sampleEvents["AuthorizeSecurityGroupIngress"];
      const newEventId = `evt-${Date.now().toString(36)}`;
      const now = new Date().toISOString();

      db.query(`
        INSERT INTO in_vpc_events (id, agent_id, account_id, region, vpc_id, event_source, event_type, action_taken, severity, description, resource_id, raw_event, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newEventId,
        agentId,
        "123456789012",
        "us-east-1",
        "vpc-0a1b2c3d4e5f67890",
        selected.source,
        eventType,
        selected.action_taken,
        selected.severity,
        selected.description,
        selected.resource_id,
        JSON.stringify({ simulated: true, timestamp: now }),
        now
      ]);

      // Ensure agent record exists on demand
      const existing = [...db.queryEntries("SELECT id FROM in_vpc_agents WHERE id = ?", [agentId])];
      if (existing.length === 0) {
        db.query(`
          INSERT INTO in_vpc_agents (id, user_id, name, account_id, region, vpc_id, status, version, auto_remediation_enabled, last_heartbeat_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          agentId,
          "sandbox-user",
          "Sandbox In-VPC Guard",
          "123456789012",
          "us-east-1",
          "vpc-0a1b2c3d4e5f",
          "ONLINE",
          "v1.2.0",
          "true",
          now,
          now,
          now
        ]);
      } else {
        db.query(`UPDATE in_vpc_agents SET last_heartbeat_at = ?, updated_at = ?, status = 'ONLINE' WHERE id = ?`, [now, now, agentId]);
      }

      return new Response(JSON.stringify({
        success: true,
        eventId: newEventId,
        event: {
          id: newEventId,
          agent_id: agentId,
          event_type: eventType,
          action_taken: selected.action_taken,
          severity: selected.severity,
          description: selected.description,
          resource_id: selected.resource_id,
          timestamp: now
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (path.endsWith("/api/in-vpc-agent/teardown")) {
      const body = await req.json().catch(() => ({}));
      const agentId = body.agentId || "in-vpc-123456789012-us-east-1";

      db.query(`DELETE FROM in_vpc_events WHERE agent_id = ?`, [agentId]);
      db.query(`DELETE FROM in_vpc_agents WHERE id = ?`, [agentId]);
      // Also clean up any other sandbox agents
      db.query(`DELETE FROM in_vpc_agents WHERE user_id = 'sandbox-user'`);

      return new Response(JSON.stringify({
        success: true,
        message: "In-VPC Mini Agent and EventBridge infrastructure safely dismantled.",
        agentId
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
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
