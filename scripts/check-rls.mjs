#!/usr/bin/env node
/**
 * Fails if any public table created in supabase/migrations lacks
 * ENABLE ROW LEVEL SECURITY in the migration set.
 */
import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve("supabase/migrations");
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

const created = new Set();
const rlsEnabled = new Set();
const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
const rlsRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s+enable\s+row\s+level\s+security/gi;

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  for (const match of sql.matchAll(createRe)) {
    created.add(match[1].toLowerCase());
  }
  for (const match of sql.matchAll(rlsRe)) {
    rlsEnabled.add(match[1].toLowerCase());
  }
}

const missing = [...created].filter((t) => !rlsEnabled.has(t)).sort();
if (missing.length) {
  console.error("Tables missing ENABLE ROW LEVEL SECURITY:");
  for (const t of missing) console.error(`  - ${t}`);
  process.exit(1);
}

console.log(`RLS enabled for all ${created.size} migrated tables.`);
