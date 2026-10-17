# Security deployment

Names only. Never paste secret values into tickets, chat, or git.

## 1. Environment variables / secrets to set

| Name | Where | Purpose |
|---|---|---|
| `CREDENTIAL_VAULT_KEY` | Supabase Edge Function secrets | AES-256-GCM KEK, ≥32 characters, unique. Fail-closed if missing. |
| `CREDENTIAL_VAULT_KEY_PREVIOUS` | Edge secrets (rotation only) | Previous dedicated vault key so ciphertext can be decrypted then re-encrypted. |
| `VAULT_ALLOW_LEGACY_DECRYPT` | Edge secrets (migration only) | Must stay unset/false in production after vault migration. When `true`, v1/unversioned rows can be decrypted with `SUPABASE_SERVICE_ROLE_KEY`. |
| `ALLOWED_ORIGINS` | Edge secrets | **Required in production.** Comma-separated browser origins. Empty allowlist (fail closed) unless `CLOUDPILOT_DEV=true`. |
| `CLOUDPILOT_DEV` | Local only | Set `true` on a developer machine so localhost origins work without `ALLOWED_ORIGINS`. Never set in production. |
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
supabase/migrations/20261017200000_pending_binding_rate_limit_org_members.sql
```

The second migration binds pending AWS actions to a stored credential/account, adds the atomic `rate_limit_hit` RPC, and restricts `org_members` so only owners can manage `owner`/`admin` rows (admins may manage `member`/`viewer` only; the last owner cannot be deleted).

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

When `ALLOWED_ORIGINS` is set, it is the exclusive allowlist (localhost is not mixed in). If it is unset in production, no browser origin receives `Access-Control-Allow-Origin`. Local dev must set `CLOUDPILOT_DEV=true` to use `http://localhost:8080` and `http://localhost:5173`.

## 4. Customer AWS onboarding (re-onboarding required)

Existing access-key connections will not work while `ENABLE_LEGACY_ACCESS_KEYS` is off. Every customer must connect a **new** cross-account role:

1. Call `aws-exchange-credentials` with `{ "action": "start_onboarding" }` while signed in.
2. Deploy `cloudformation/cloudpilot-readonly-role.yaml` with:
   - `CloudPilotAwsAccountId` = `CLOUDPILOT_AWS_ACCOUNT_ID`
   - `ExternalId` = the value CloudPilot generated (server-stored)
3. Paste the role ARN into the CloudPilot credentials panel and Connect.
4. Optional writes: `cloudformation/cloudpilot-write-role.yaml` (still requires ExternalId; IAM privilege-escalation APIs denied). Mutating API calls also need an in-app Approve click. The approval card shows full parameters and the target account; the pending row is bound to the stored credential, not a request-body `credentialId`.

Customers who skip re-onboarding will see “Connect an AWS account” / legacy-keys-disabled errors.

## 5. Vault key rotation and legacy decrypt

One-shot migration off the old service-role KEK:

1. Set `CREDENTIAL_VAULT_KEY` (dedicated, ≥32 characters).
2. Temporarily set `VAULT_ALLOW_LEGACY_DECRYPT=true` so remaining `v1`/unversioned rows can be read.
3. Call `aws-credential-vault` with `{ "action": "reencrypt_all_v2" }` using the service role. This re-encrypts every `stored_aws_credentials` ciphertext to `v2:` and sets `encryption_key_version`.
4. Confirm every row has `encryption_key_version = v2`.
5. **Unset** `VAULT_ALLOW_LEGACY_DECRYPT`. After this, v2 ciphertext never falls back to `SUPABASE_SERVICE_ROLE_KEY`.

Dedicated-key rotation (after all rows are v2):

1. Set `CREDENTIAL_VAULT_KEY_PREVIOUS` to the old dedicated key.
2. Set `CREDENTIAL_VAULT_KEY` to the new dedicated key.
3. Redeploy functions (or re-run `reencrypt_all_v2`).
4. After all rows show `encryption_key_version = v2` under the new key, unset `CREDENTIAL_VAULT_KEY_PREVIOUS`.

Do not rotate `SUPABASE_SERVICE_ROLE_KEY` as a substitute for the vault key.

## 6. Redeploy functions

```bash
supabase functions deploy aws-agent aws-agent-tools aws-agent-scanner aws-agent-ops aws-executor aws-exchange-credentials aws-credential-vault webhook-notify guardian-scheduler guardian-event-processor stripe-webhook stripe-checkout team-invite
```

## 7. After deploy smoke checks

- Unauthenticated `POST /functions/v1/aws-agent` → 401.
- `aws-executor` with anon JWT → 401.
- Connect via role ARN + ExternalId; chat a read-only question.
- Ask the agent to `CreateAccessKey` → blocked.
- Ask for a security-group mutation → pending row with **full parameters and account id**; Approve in UI runs against the stored credential; Reject works.
- Secret reads (`GetSecretValue`, SSM `GetParameter` with `WithDecryption`) → pending, not auto-run.
- Register a webhook URL `http://127.0.0.1/` or `https://[fe80::1]/` → rejected.
- `npm run build` and vitest are required CI checks on this repository.

## 8. What this release does not claim

GitHub Dependabot, secret scanning, push protection, and CodeQL are repository settings already enabled by the owner; they are not toggled by this PR. Protect `main` with required `check`, `frontend`, and `Security` workflows.
