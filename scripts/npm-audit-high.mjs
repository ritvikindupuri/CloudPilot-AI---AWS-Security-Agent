#!/usr/bin/env node
/**
 * Fails CI on high/critical npm advisories except those with no upstream patch.
 * Chained packages that only inherit an allowed root advisory are ignored.
 */
import { execSync } from "node:child_process";

/** Advisories with no upstream fix as of this PR. Revisit when a patch ships. */
const NO_UPSTREAM_FIX = new Set([
  "GHSA-vfj7-8cjw-p6xm", // braces nested-pattern stack DoS; range=*
]);

function ghsaFromVia(entry) {
  if (!entry || typeof entry !== "object") return null;
  const url = String(entry.url || "");
  const match = url.match(/GHSA-[\w-]+/);
  return match ? match[0] : null;
}

let stdout = "";
try {
  stdout = execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (err) {
  stdout = err.stdout || "";
}

if (!stdout.trim()) {
  console.error("npm audit produced no JSON");
  process.exit(1);
}

const report = JSON.parse(stdout);
const vulns = report.vulnerabilities || {};
const blockers = [];

for (const [name, vuln] of Object.entries(vulns)) {
  if (!["high", "critical"].includes(vuln.severity)) continue;
  const via = Array.isArray(vuln.via) ? vuln.via : [];
  const direct = via.filter((v) => v && typeof v === "object");
  if (direct.length === 0) continue;
  const ghsas = direct.map(ghsaFromVia).filter(Boolean);
  if (ghsas.length && ghsas.every((id) => NO_UPSTREAM_FIX.has(id))) continue;
  blockers.push({
    name,
    severity: vuln.severity,
    ghsas: ghsas.length ? ghsas : direct.map((v) => v.title || v.name || "unknown"),
  });
}

if (blockers.length) {
  console.error("High/critical npm advisories with an available fix (or a new unreviewed GHSA):");
  for (const b of blockers) {
    console.error(`  - ${b.severity} ${b.name}: ${b.ghsas.join(", ")}`);
  }
  process.exit(1);
}

const allowed = Object.entries(vulns).filter(([, v]) => ["high", "critical"].includes(v.severity));
if (allowed.length) {
  console.log(
    `npm audit: ${allowed.length} high/critical finding(s) allowed because no upstream patch exists (${[...NO_UPSTREAM_FIX].join(", ")}).`,
  );
} else {
  console.log("npm audit: no high/critical vulnerabilities.");
}
