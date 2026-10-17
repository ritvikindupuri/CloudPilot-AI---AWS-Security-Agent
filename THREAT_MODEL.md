# CloudPilot threat model (2026-10-17)

Status values: **fixed** (code prevent), **mitigated** (reduced, residual risk remains), **manual-only** (owner/process, not code).

| ID | Attack vector | Status | Evidence |
|---|---|---|---|
| C1 | Anonymous caller uses `aws-agent` (verify_jwt=false, `userId=null`) to spend Anthropic quota and run AWS tools | **fixed** | `supabase/config.toml` `aws-agent.verify_jwt=true`; `aws-agent/index.ts` returns 401 when `getUser` fails. Health GET remains unauthenticated. Handler test in `aws-agent/handler.test.ts`. |
| C2 | Unauthenticated `aws-executor` proxy accepts any SDK command and caller `endpoint` (SSRF) | **fixed** | `requireServiceRole`; `classifyAwsOperation` allowlists Get/List/Describe/Head; writes need a stored UI approval or a server-built `platformPurpose` allowlist; `sanitizeAwsClientConfig` strips `endpoint` and provider overrides; CORS omits ACAO on mismatch; generic errors. Handler tests in `aws-executor/handler.test.ts`. |
| C3 | Mutating / IAM privilege-escalation calls with no server-side human gate; prompt injection via AWS tags | **mitigated** | Privilege-escalation, PassRole combinations, and defense-evasion ops blocked in `_shared/aws-command-policy.ts`; other writes and secret-returning reads create `pending_aws_actions` bound to stored `credential_id`/`account_id` and execute only after UI Approve; executor consumes the approval atomically (no replay); tool results always wrapped in a per-call nonce `<untrusted_aws_data>` fence with escaped payload; chat “confirm” is ignored (`userHasConfirmedMutation = false`). Residual: a determined model can still *ask* the user to approve a malicious pending card — the card now shows full params and target account. |
| H1 | Browser-supplied AWS keys; AssumeRole without ExternalId (confused deputy) | **fixed** | Agent no longer reads credentials from the body; server STS AssumeRole with per-customer ExternalId (`_shared/sts-credentials.ts`, `customer-aws.ts`); `cloudformation/cloudpilot-readonly-role.yaml` requires `sts:ExternalId`; write perms are opt-in (`cloudpilot-write-role.yaml`); `ENABLE_LEGACY_ACCESS_KEYS` defaults off. Guardian event-processor auto-fixes use stored credentials and the executor policy path. |
| H2 | Vault KEK derived from `SUPABASE_SERVICE_ROLE_KEY` | **mitigated** | `CREDENTIAL_VAULT_KEY` required; v2 ciphertext; previous dedicated key via `CREDENTIAL_VAULT_KEY_PREVIOUS`; legacy service-role decrypt only for `v1`/unversioned rows and only when `VAULT_ALLOW_LEGACY_DECRYPT=true` (default off). Rows never used stay on v1 until the one-shot `reencrypt_all_v2` action. |
| H3 | RLS missing on organizations, org_members, user_roles, automation_runs, guardian_event_activity | **mitigated** | `20261017120000_enterprise_security_hardening.sql` enables RLS; `20261017200000_pending_binding_rate_limit_org_members.sql` stops admin→owner promotion and last-owner deletion. CI `scripts/check-rls.mjs` fails if any migrated public table lacks `ENABLE ROW LEVEL SECURITY`. |
| H4 | No secret/supply-chain CI; two lockfiles; critical/high npm advisories | **mitigated** | npm lockfile only; `.github/workflows/security.yml` (gitleaks CLI with pinned checksum, `scripts/npm-audit-high.mjs`, RLS check); Actions pinned to commit SHAs. Remaining high finding is braces GHSA-vfj7-8cjw-p6xm (no upstream patch; build-tool nested-glob DoS). |
| M1 | In-memory per-isolate rate limits | **mitigated** | DB limiter `_shared/rate-limit-db.ts` via atomic `rate_limit_hit` RPC and unique `(key, window_bucket)`. Fail-closed on DB error. Concurrent first hits no longer lock a user out of the whole window. |
| M2 | CORS localhost fallback | **fixed** | `_shared/cors.ts` echoes ACAO only for allowlisted Origin. Production without `ALLOWED_ORIGINS` has an empty allowlist unless `CLOUDPILOT_DEV=true`. |
| M3 | No frontend CSP/HSTS | **fixed** | `public/_headers` (CSP without `unsafe-eval`, Google Fonts allowlisted, HSTS, `frame-ancestors 'none'`, nosniff, Referrer-Policy). |
| M4 | Raw `e.message` to clients | **mitigated** | Generic client bodies in user-facing functions; details in `logInternalError`. Some tool-internal strings may still mention AWS API names. |
| M5 | webhook-notify SSRF (http, redirects, metadata IPs) | **mitigated** | HTTPS-only, DNS-resolved private/link-local/metadata blocked including `fe80::/10`, IPv4-compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`, and 6to4 `2002::/16`, `redirect: "error"` (`_shared/ssrf.ts`). Residual DNS-rebinding TOCTOU remains. |
| M6 | Client-supplied `geminiApiKey` | **fixed** | Removed from request bodies; server uses env only. |
| M7 | Guardian shared-secret compared with `===` | **fixed** | `constantTimeCompare` in scheduler, event-processor, webhook-notify. Scheduler authenticates before applying the identity rate-limit key. `verify_jwt=false` remains for cron; exception documented in `config.toml`. |
| Stripe webhook | Unauthenticated Stripe events if secret unset | **fixed** | `STRIPE_WEBHOOK_SECRET` required; `verify_jwt=false` because Stripe has no JWT. |
| L1 | Actions pinned to tags | **fixed** | SHA pins in workflows. `deno-check.yml` has `permissions: contents: read`. Frontend `npm run build` and vitest are required checks. |
| L2 | Root clutter / dual lockfiles | **fixed** | Removed `patch.diff`, `patch_revert_eslint.js`, `bun.lock`, `bun.lockb`. |
| L3 | Historical `.env` with anon JWT in git | **manual-only** | Untracked now; history still has public anon key (`role=anon`). Low risk; optional `git filter-repo` by owner. |
| L4 | No immutable customer-exportable audit log | **manual-only** | Customer-side CloudWatch/WORM push is allowlisted (`/cloudpilot/agent-audit`, `cloudpilot-audit-worm-*`) and no longer silently 403s. CloudPilot’s own DB log is not tamper-evident WORM. |
| N1 | SOC 2 / ISO / pen test / DPA / SSO | **manual-only** | Process and legal, not this PR. |
| N2 | security.txt | **fixed** | `public/.well-known/security.txt`. |

## Residual risk

- Platform AWS keys (`CLOUDPILOT_AWS_*`) can AssumeRole into every onboarded customer role. Protect those keys and rotate ExternalIds if they leak.
- Typed apply tools queue `pending_aws_actions` for UI approval. `manage_iam_access` CreatePolicy/Attach*Policy stays **blocked** (privilege escalation), not approvable. Chat “confirm” is never an authorization.
- Guardian auto-fix is a standing, user-configured approval for a small reversible set (S3 public-access block / encryption, CloudTrail StartLogging, EC2 RevokeSecurityGroupIngress) and still cannot run BLOCKED operations.
- Webhook SSRF checks resolve DNS then fetch by hostname (DNS-rebinding TOCTOU).
- npm audit may still report transitive issues in build tooling after upgrades.
- Existing customers who connected with long-lived access keys must re-onboard with a cross-account role + ExternalId after `ENABLE_LEGACY_ACCESS_KEYS` stays off.
