# Security deployment

Names only. Never paste secret values into tickets, chat, or git.

## 1. Environment variables / secrets to set

| Name | Where | Purpose |
|---|---|---|
| `CREDENTIAL_VAULT_KEY` | Supabase Edge Function secrets | AES-256-GCM KEK, ≥32 characters, unique. Fail-closed if missing. |
| `CREDENTIAL_VAULT_KEY_PREVIOUS` | Edge secrets (rotation only) | Previous vault key so ciphertext can be decrypted then re-encrypted. |
| `ALLOWED_ORIGINS` | Edge secrets | Comma-separated browser origins. CORS is fail-closed. |
| `CLOUDPILOT_AWS_ACCESS_KEY_ID` | Edge secrets | Platform principal used to `sts:AssumeRole` into customer roles. |
| `CLOUDPILOT_AWS_SECRET_ACCESS_KEY` | Edge secrets | Pair for the platform principal. |
| `CLOUDPILOT_AWS_ACCOUNT_ID` | Edge secrets | 12-digit account ID customers put in CloudFormation as the trusted principal. |
| `GUARDIAN_AUTOMATION_WEBHOOK_SECRET` | Edge secrets | Long random secret for scheduler/event-processor/webhook cron. Rotate after this PR. |
| `STRIPE_WEBHOOK_SECRET` | Edge secrets | Required. Unsigned Stripe events are rejected. |
| `STRIPE_SECRET_KEY` | Edge secrets | Checkout. |
| `ANTHROPIC_API_KEY` | Edge secrets | Model calls. |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge secrets | Server DB. Do **not** use as the vault KEK. |
| `SUPABASE_ANON_KEY` | Public client | Publishable. |
| `ENABLE_LEGACY_ACCESS_KEYS` | Edge secrets | Must stay unset/false in production. |

Frontend may only expose `VITE_SUPABASE_URL` and the publishable anon key.

## 2. Migrations

Apply in order, including:

```text
supabase/migrations/20261017120000_enterprise_security_hardening.sql
```

This enables RLS on `organizations`, `org_members`, `user_roles`, `automation_runs`, `guardian_event_activity`; creates `pending_aws_actions` and `rate_limit_entries`; adds `encrypted_external_id` / `encryption_key_version` on `stored_aws_credentials`.

```bash
supabase db push
# or: npm run db:push
```

Verify in SQL:

```sql
select relname, relrowsecurity
from pg_class
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where nspname = 'public' and relkind = 'r'
order by relname;
```

Every public table must show `relrowsecurity = true`.

## 3. ALLOWED_ORIGINS

Production example:

```text
ALLOWED_ORIGINS=https://app.example.com,https://www.example.com
```

When `ALLOWED_ORIGINS` is set, it is the exclusive allowlist (localhost is not mixed in). Local dev may omit the variable to use `http://localhost:8080` and `http://localhost:5173`.

## 4. Customer AWS onboarding

1. Call `aws-exchange-credentials` with `{ "action": "start_onboarding" }` while signed in.
2. Deploy `cloudformation/cloudpilot-readonly-role.yaml` with:
   - `CloudPilotAwsAccountId` = `CLOUDPILOT_AWS_ACCOUNT_ID`
   - `ExternalId` = the value CloudPilot generated (server-stored)
3. Paste the role ARN into the CloudPilot credentials panel and Connect.
4. Optional writes: `cloudformation/cloudpilot-write-role.yaml` (still requires ExternalId; IAM privesc APIs denied). Mutating API calls also need an in-app Approve click.

## 5. Vault key rotation

1. Generate a new `CREDENTIAL_VAULT_KEY`.
2. Set `CREDENTIAL_VAULT_KEY_PREVIOUS` to the old value.
3. Set `CREDENTIAL_VAULT_KEY` to the new value.
4. Redeploy functions. Decrypt will migrate ciphertext to `v2` on next use.
5. After all rows show `encryption_key_version = v2`, unset `CREDENTIAL_VAULT_KEY_PREVIOUS`.

Do not rotate `SUPABASE_SERVICE_ROLE_KEY` as a substitute for the vault key.

## 6. Redeploy functions

```bash
supabase functions deploy aws-agent aws-agent-tools aws-agent-scanner aws-agent-ops aws-executor aws-exchange-credentials aws-credential-vault webhook-notify guardian-scheduler guardian-event-processor stripe-webhook stripe-checkout team-invite
```

## 7. GitHub org settings (manual)

Enable Dependabot alerts + security updates, secret scanning, push protection, and CodeQL default setup. Protect `main` (PR review + required `check` and `Security` workflows). This repository cannot flip those switches from a PR.

## 8. After deploy smoke checks

- Unauthenticated `POST /functions/v1/aws-agent` → 401.
- `aws-executor` with anon JWT → 401.
- Connect via role ARN + ExternalId; chat a read-only question.
- Ask the agent to `CreateAccessKey` → blocked.
- Ask for a security-group mutation → pending row; Approve in UI; Reject works.
- Register a webhook URL `http://127.0.0.1/` → rejected.
