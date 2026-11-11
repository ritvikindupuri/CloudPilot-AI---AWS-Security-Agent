#!/usr/bin/env node
/**
 * Asserts SECURITY DEFINER RPCs are not left executable by anon/authenticated.
 * Parses supabase/migrations (apply-order) so CI fails if a later GRANT reopens them.
 */
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve("supabase/migrations");
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");

const required = [
  {
    name: "REVOKE rate_limit_hit FROM anon, authenticated",
    re: /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rate_limit_hit\s*\(\s*text\s*,\s*integer\s*,\s*integer\s*\)\s+FROM\s+anon\s*,\s*authenticated\s*;/i,
  },
  {
    name: "REVOKE cleanup_rate_limit_entries FROM anon, authenticated",
    re: /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cleanup_rate_limit_entries\s*\(\s*\)\s+FROM\s+anon\s*,\s*authenticated\s*;/i,
  },
  {
    name: "REVOKE is_org_member FROM anon",
    re: /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_org_member\s*\(\s*uuid\s*,\s*uuid\s*\)\s+FROM\s+anon\s*;/i,
  },
  {
    name: "REVOKE get_org_role FROM anon",
    re: /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_org_role\s*\(\s*uuid\s*,\s*uuid\s*\)\s+FROM\s+anon\s*;/i,
  },
  {
    name: "GRANT rate_limit_hit TO service_role",
    re: /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rate_limit_hit\s*\(\s*text\s*,\s*integer\s*,\s*integer\s*\)\s+TO\s+service_role\s*;/i,
  },
  {
    name: "GRANT cleanup_rate_limit_entries TO service_role",
    re: /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cleanup_rate_limit_entries\s*\(\s*\)\s+TO\s+service_role\s*;/i,
  },
  {
    name: "has_function_privilege anon rate_limit_hit EXECUTE assertion",
    re: /has_function_privilege\s*\(\s*'anon'\s*,\s*'public\.rate_limit_hit\(text,integer,integer\)'\s*,\s*'EXECUTE'\s*\)/i,
  },
];

const missing = required.filter((item) => !item.re.test(sql));
if (missing.length) {
  console.error("Missing required function-privilege statements:");
  for (const item of missing) console.error(`  - ${item.name}`);
  process.exit(1);
}

function lastIndex(re) {
  let last = -1;
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const copy = new RegExp(re.source, flags);
  for (const match of sql.matchAll(copy)) last = match.index ?? -1;
  return last;
}

function assertNoGrantAfterRevoke(fnLabel, revokeRe, grantAnonRe) {
  const revokeAt = lastIndex(revokeRe);
  const grantAt = lastIndex(grantAnonRe);
  if (grantAt > revokeAt) {
    console.error(`${fnLabel} is GRANTed to anon/authenticated after the REVOKE`);
    process.exit(1);
  }
}

assertNoGrantAfterRevoke(
  "rate_limit_hit",
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rate_limit_hit[^;]*FROM\s+anon/gi,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rate_limit_hit[^;]*TO\s+(?:anon|authenticated)\b/gi,
);
assertNoGrantAfterRevoke(
  "cleanup_rate_limit_entries",
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cleanup_rate_limit_entries[^;]*FROM\s+anon/gi,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cleanup_rate_limit_entries[^;]*TO\s+(?:anon|authenticated)\b/gi,
);
assertNoGrantAfterRevoke(
  "is_org_member",
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_org_member[^;]*FROM\s+anon/gi,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_org_member[^;]*TO\s+anon\b/gi,
);
assertNoGrantAfterRevoke(
  "get_org_role",
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_org_role[^;]*FROM\s+anon/gi,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_org_role[^;]*TO\s+anon\b/gi,
);

console.log(
  `Function EXECUTE grants: anon cannot call rate_limit_hit/cleanup_rate_limit_entries/is_org_member/get_org_role (${files.length} migrations).`,
);
