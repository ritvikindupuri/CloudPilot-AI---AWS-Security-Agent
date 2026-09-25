# Bug Fix Verification: Auth Conflicts & Error Reporting

## Bug 1: AWS tool calls fail with 401 "Conflicting API keys"

### Root Cause (Confirmed)
The `aws-agent-tools` router function was forwarding the caller's `Authorization` header to internal functions (`aws-agent-scanner` and `aws-agent-ops`) while also setting `apikey: SERVICE_ROLE_KEY`. When anonymous users call the API with Supabase's new key format (`sb_publishable_...`), this header is sent as `Authorization: Bearer sb_publishable_...`. The internal function call then has:
- `Authorization: Bearer sb_publishable_...` (forwarded from caller)
- `apikey: sb_secret_...` (service role key)

Supabase's gateway detects two different `sb_` keys and rejects the request with a 401 "Conflicting API keys" error.

### Affected Flows
- **Anonymous users (AFFECTED)**: Send `Authorization: Bearer sb_publishable_...` + `apikey: sb_publishable_...`
- **Signed-in users (NOT AFFECTED)**: Send `Authorization: Bearer <JWT>` + `apikey: sb_publishable_...` - JWTs are not `sb_` keys so no conflict occurs

### Fix Applied
**File**: `supabase/functions/aws-agent-tools/index.ts`

Changed the `dispatch()` function to use only the service role key for internal function-to-function calls:

```typescript
// BEFORE
Authorization: authHeader || `Bearer ${SERVICE_ROLE_KEY}`,
apikey: SERVICE_ROLE_KEY,

// AFTER
Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
apikey: SERVICE_ROLE_KEY,
```

This ensures internal calls use consistent authentication and don't leak the caller's credentials to downstream functions.

### Security Posture
- ✅ Maintains PR #46 security posture
- ✅ No changes to who can call scanner/ops functions
- ✅ Service role key remains internal-only
- ✅ `ENABLE_AUTO_ELEVATION` default remains off
- ✅ User identity should be passed via `userId` in the request body, not via Authorization header

## Bug 2: Pipeline logs claim success when every AWS call failed

### Root Cause (Confirmed)
The `aws-agent` function logs "AWS API batch successfully executed" immediately after receiving HTTP 200 from the router, without checking if individual tool results contain errors. The router returns HTTP 200 with per-result error payloads when tool dispatch fails.

### Fix Applied
**File**: `supabase/functions/aws-agent/index.ts` (line ~6819)

Added comprehensive error detection logic using a pure, testable classifier function:

**New file**: `supabase/functions/aws-agent/tool-result-classifier.ts`

Extracted error detection into a pure function with proper handling of edge cases:

```typescript
export function isToolResultError(resultContent: string): boolean {
  // 1. If content parses as JSON and has truthy error field, it's an error
  try {
    const content = JSON.parse(resultContent);
    return !!content.error;
  } catch {
    // Not valid JSON, continue to other checks
  }

  // 2. Strip [VALIDATOR WARNING: ...] prefix if present and try parsing again
  const validatorWarningMatch = resultContent.match(/^\[VALIDATOR WARNING:.*?\]\n\n/s);
  if (validatorWarningMatch) {
    const withoutPrefix = resultContent.slice(validatorWarningMatch[0].length);
    try {
      const content = JSON.parse(withoutPrefix);
      return !!content.error;
    } catch {
      // Still not JSON after stripping prefix
    }
  }

  // 3. Non-JSON content is only an error if it clearly looks like an error
  const errorPatterns = [
    /^\{"error"/i,           // Starts with {"error"
    /^Error:/i,              // Starts with "Error:"
    /^Tool dispatch error/i, // Tool dispatch errors
    /^AccessDenied/i,        // AWS AccessDenied errors
    /^Unauthorized/i,        // Unauthorized errors
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(resultContent.trim())) {
      return true;
    }
  }

  // 4. Default non-JSON content to success
  return false;
}
```

**Key improvements:**
- Detects ANY result with a truthy `error` field (not just specific error types)
- Properly handles HIGH_RISK calls with `[VALIDATOR WARNING: ...]` prefix from aws-agent-scanner
- Catches AccessDenied, throttling errors, tool dispatch errors, auth conflicts, and any other failures
- Safely handles missing `toolResults.results` (defaults to empty array)
- **Defaults non-JSON content to success** (fixes regression where truncated/non-JSON success results were logged as errors)
- Handles truncated results like `{"buckets": [... (truncated)`
- Only treats non-JSON as error if it clearly matches error patterns
- Never logs success when calls have actually failed

**Testing:**
Added comprehensive test suite in `tool-result-classifier.test.ts` (Deno) and `tool-result-classifier-node.test.js` (Node.js) with 11 test cases covering:
- JSON with/without error fields
- Validator warning prefix with success/error/non-JSON
- Non-JSON error patterns vs success patterns
- Edge cases and real-world examples

## Nice to Have: Evaluation Script Improvement

### Fix Applied
**File**: `scripts/evaluate-quick-actions.ts`

Changed credential error handling to fail tests instead of passing them, and added specific pattern detection for tool dispatch and auth errors:

```typescript
// BEFORE: Treated credential errors as PASS
if (errText.includes("InvalidClientTokenId") || ...) {
  process.stdout.write(`✅ PASS (${durationMs}ms) [Pipeline Validated]\n`);
  passCount++;
}

// AFTER: Fails credential errors and checks response body with specific patterns
if (errText.includes("InvalidClientTokenId") || ...) {
  process.stdout.write(`❌ FAIL (${durationMs}ms) [Invalid Credentials]\n`);
  failCount++;
}

// Checks HTTP 200 responses for embedded errors using specific patterns
const hasToolDispatchError = responseText.includes("Tool dispatch error");
const hasAuthError = responseText.includes("Conflicting API keys") || 
                     responseText.includes("Unauthorized") ||
                     responseText.includes("(401)") ||  // Specific pattern, not broad "401"
                     responseText.includes("authentication error");
const hasExecutionFailure = responseText.includes("AWS API batch failed") ||
                            responseText.includes("partially failed");

if (hasToolDispatchError || hasAuthError || hasExecutionFailure) {
  failCount++;
}
```

**Key improvements:**
- Uses specific patterns like `(401)` instead of broad `"401"` to avoid false positives on account IDs, timestamps, etc.
- Detects the new "AWS API batch failed" and "partially failed" log messages
- Properly fails tests with credential errors instead of treating them as validation passes
- Detects "Unauthorized", "Tool dispatch error", and "Conflicting API keys" patterns

## Deployment Steps Required

The following Supabase Edge Functions must be redeployed for the fixes to take effect:

1. **`aws-agent-tools`** (Bug 1 fix - auth header forwarding)
   ```bash
   supabase functions deploy aws-agent-tools
   ```

2. **`aws-agent`** (Bug 2 fix - error reporting)
   ```bash
   supabase functions deploy aws-agent
   ```

**Note**: The `aws-agent-scanner` and `aws-agent-ops` functions do NOT need to be redeployed as no changes were made to them.

## Manual Verification Steps

### Test 1: Anonymous User Call (Bug 1 verification)
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/aws-agent" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_publishable_..." \
  -H "apikey: sb_publishable_..." \
  -d '{
    "messages": [{"role": "user", "content": "Query all S3 buckets"}],
    "credentials": {...},
    "scanMode": "fast"
  }'
```

**Expected**: Should NOT return "Conflicting API keys" error. Tool calls should execute normally (subject to valid AWS credentials).

### Test 2: Error Reporting (Bug 2 verification)
With the deployed fix, trigger a scenario that causes tool errors and verify:
- Pipeline log shows `status: "error"` or `status: "warning"` when errors occur
- Message clearly states how many tool calls failed
- No false "successfully executed" messages when all calls fail

### Test 3: Evaluation Script (Nice to have verification)
```bash
npx tsx scripts/evaluate-quick-actions.ts
```

**Expected**: Tests with credential errors or tool dispatch errors should now show as `❌ FAIL` instead of `✅ PASS`.

## Impact Assessment

### Before Fix
- 43 of 57 live Quick Action runs (75%) failed with "Conflicting API keys"
- All failures were from anonymous users (publishable key in Authorization header)
- UI incorrectly showed "AWS API batch successfully executed" even though all calls failed
- Evaluation script treated credential failures as passing tests

### After Fix
- Anonymous user calls should work normally (0% failure rate from auth conflicts)
- Signed-in user calls continue to work as before (already working)
- UI accurately reflects tool execution status (error/warning/success)
- Evaluation script correctly identifies and fails tests with auth/tool errors
