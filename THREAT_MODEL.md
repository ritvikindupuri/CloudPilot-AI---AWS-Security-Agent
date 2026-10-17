# CloudPilot threat model (2026-10-17)

Status values: **fixed** (code prevent), **mitigated** (reduced, residual risk remains), **manual-only** (owner/process, not code).

| ID | Attack vector | Status | Evidence |
|---|---|---|---|
| C1 | Anonymous caller uses `aws-agent` (verify_jwt=false, `userId=null`) to spend Anthropic quota and run AWS tools | **fixed** | `supabase/config.toml` `aws-agent.verify_jwt=true`; `aws-agent/index.ts` returns 401 when `getUser` fails. Health GET remains unauthenticated. |
| C2 | Unauthenticated `aws-executor` proxy accepts any SDK command and caller `endpoint` (SSRF) | **fixed** | `requireServiceRole`; `classifyAwsOperation` allowlists Get/List/Describe/Head; writes need a stored UI approval; `sanitizeAwsClientConfig` strips `endpoint` and provider overrides; CORS omits ACAO on mismatch; generic errors. |
| C3 | Mutating / IAM privilege-escalation calls with no server-side human gate; prompt injection via AWS tags | **fixed** | Privilege-escalation ops blocked in `_shared/aws-command-policy.ts`; other writes create `pending_aws_actions` and execute only after UI Approve; executor consumes the approval atomically (no replay); tool results wrapped in `<untrusted_aws_data>`; chat “confirm” is ignored (`userHasConfirmedMutation = false` in aws-agent, scanner, and ops). |
| H1 | Browser-supplied AWS keys; AssumeRole without ExternalId (confused deputy) | **fixed** | Agent no longer reads credentials from the body; server STS AssumeRole with per-customer ExternalId (`_shared/sts-credentials.ts`, `customer-aws.ts`); `cloudformation/cloudpilot-readonly-role.yaml` requires `sts:ExternalId`; write perms are opt-in (`cloudpilot-write-role.yaml`); `ENABLE_LEGACY_ACCESS_KEYS` defaults off. |
| H2 | Vault KEK derived from `SUPABASE_SERVICE_ROLE_KEY` | **fixed** | `CREDENTIAL_VAULT_KEY` required; v2 ciphertext; decrypt-old / encrypt-new via `CREDENTIAL_VAULT_KEY_PREVIOUS` and legacy service-role material; fail-closed if key missing. |
| H3 | RLS missing on organizations, org_members, user_roles, automation_runs, guardian_event_activity | **fixed** | `supabase/migrations/20261017120000_enterprise_security_hardening.sql`; CI `scripts/check-rls.mjs` fails if any migrated public table lacks `ENABLE ROW LEVEL SECURITY`. |
| H4 | No secret/supply-chain CI; two lockfiles; critical/high npm advisories | **mitigated** | npm lockfile only; `.github/workflows/security.yml` (gitleaks CLI with pinned checksum, `scripts/npm-audit-high.mjs`, RLS check); Actions pinned to commit SHAs. Remaining high finding is braces GHSA-vfj7-8cjw-p6xm (no upstream patch; build-tool nested-glob DoS). Dependabot/secret scanning/branch protection are GitHub **manual-only** settings. |
| M1 | In-memory per-isolate rate limits | **fixed** | DB limiter `_shared/rate-limit-db.ts` on aws-agent, scanner, ops, guardian-scheduler; fail-closed on DB error. |
| M2 | CORS localhost fallback | **fixed** | `_shared/cors.ts` echoes ACAO only for allowlisted Origin. |
| M3 | No frontend CSP/HSTS | **fixed** | `public/_headers` (CSP without `unsafe-eval`, HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy). |
| M4 | Raw `e.message` to clients | **mitigated** | Generic client bodies in user-facing functions; details in `logInternalError`. Some tool-internal strings may still mention AWS API names. |
| M5 | webhook-notify SSRF (http, redirects, metadata IPs) | **fixed** | HTTPS-only, DNS-resolved private/link-local/metadata blocked, `redirect: "error"` (`_shared/ssrf.ts`). |
| M6 | Client-supplied `geminiApiKey` | **fixed** | Removed from request bodies; server uses env only. |
| M7 | Guardian shared-secret compared with `===` | **fixed** | `constantTimeCompare` in scheduler, event-processor, webhook-notify. `verify_jwt=false` remains for cron; exception documented in `config.toml`. |
| Stripe webhook | Unauthenticated Stripe events if secret unset | **fixed** | `STRIPE_WEBHOOK_SECRET` required; `verify_jwt=false` because Stripe has no JWT. |
| L1 | Actions pinned to tags | **fixed** | SHA pins in workflows. |
| L2 | Root clutter / dual lockfiles | **fixed** | Removed `patch.diff`, `patch_revert_eslint.js`, `bun.lock`, `bun.lockb`. |
| L3 | Historical `.env` with anon JWT in git | **manual-only** | Untracked now; history still has public anon key (`role=anon`). Low risk; optional `git filter-repo` by owner. |
| L4 | No immutable customer-exportable audit log | **manual-only** | `agent_audit_log` / compliance tables exist; not tamper-evident WORM in CloudPilot’s DB. |
| N1 | SOC 2 / ISO / pen test / DPA / SSO | **manual-only** | Process and legal, not this PR. |
| N2 | security.txt | **fixed** | `public/.well-known/security.txt`. |

## Residual risk

- Platform AWS keys (`CLOUDPILOT_AWS_*`) can AssumeRole into every onboarded customer role. Protect those keys and rotate ExternalIds if they leak.
- Typed preview tools (`manage_security_group_rule`, `manage_iam_access`, `manage_cost_rule`) stay preview-only; they do not apply writes from chat. Generic `execute_aws_api` mutations require a stored UI approval. Runbook steps marked `risk=confirm` still pause for an in-product continue, which is a separate workflow from the generic AWS call tool.
- When `ALLOWED_ORIGINS` is unset, local dev origins are allowed. Production must set `ALLOWED_ORIGINS` to the real app origin(s); localhost is then excluded.
- Webhook SSRF checks resolve DNS then fetch by hostname (DNS-rebinding TOCTOU). Private/link-local/metadata IPs and dword/hex forms are blocked; residual rebinding risk is accepted.
- npm audit may still report transitive issues in build tooling after upgrades.
