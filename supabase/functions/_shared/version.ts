/**
 * Build version and Git SHA tracking
 * Provides version information for deployed edge functions
 */

// This will be replaced by CI/CD during deployment
// Format: SHORT_SHA (e.g., "fc875b9")
export const GIT_SHA = Deno.env.get("GIT_SHA") || "dev";

// Full version string
export const VERSION = `cloudpilot-${GIT_SHA}`;

// Build timestamp (ISO 8601)
export const BUILD_TIMESTAMP = Deno.env.get("BUILD_TIMESTAMP") || new Date().toISOString();

/**
 * Get version metadata for inclusion in responses
 */
export function getVersionMeta() {
  return {
    version: VERSION,
    gitSha: GIT_SHA,
    buildTimestamp: BUILD_TIMESTAMP,
  };
}

/**
 * Get a report ID with timestamp
 * Format: CPR-YYYYMMDD-HHmmss
 */
export function generateReportId(): string {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `CPR-${yyyymmdd}-${hhmmss}`;
}

/**
 * Get current timestamp in ISO 8601 format
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}
