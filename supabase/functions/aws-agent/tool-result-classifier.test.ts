/**
 * Tests for tool result error classification
 * Run with: deno test --allow-env tool-result-classifier.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * Determines if a tool result represents an error.
 * 
 * Rules:
 * 1. If content parses as JSON and has a truthy `error` field, it's an error
 * 2. If content has [VALIDATOR WARNING: ...] prefix, strip it and try parsing again
 * 3. Non-JSON content is only an error if it clearly looks like an error
 * 4. Default non-JSON content to success
 */
export function isToolResultError(resultContent: string): boolean {
  if (!resultContent || resultContent.trim().length === 0) {
    return false; // Empty content is not an error
  }

  // Try parsing as JSON first
  try {
    const content = JSON.parse(resultContent);
    return !!content.error;
  } catch {
    // Not valid JSON, continue to other checks
  }

  // Strip [VALIDATOR WARNING: ...] prefix if present and try parsing again
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

  // For non-JSON content, check if it clearly looks like an error
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

  // Default: non-JSON content that doesn't match error patterns is success
  return false;
}

// ── Test Suite ──────────────────────────────────────────────────────────────

Deno.test("isToolResultError - JSON with error field", () => {
  assertEquals(isToolResultError(JSON.stringify({ error: "Something failed" })), true);
  assertEquals(isToolResultError(JSON.stringify({ error: "Tool dispatch error from aws-agent-scanner (401)" })), true);
  assertEquals(isToolResultError(JSON.stringify({ error: "Conflicting API keys" })), true);
  assertEquals(isToolResultError(JSON.stringify({ error: "AccessDenied" })), true);
});

Deno.test("isToolResultError - JSON without error field", () => {
  assertEquals(isToolResultError(JSON.stringify({ result: "success", data: [] })), false);
  assertEquals(isToolResultError(JSON.stringify({ buckets: [], count: 0 })), false);
  assertEquals(isToolResultError(JSON.stringify({ status: "ok" })), false);
});

Deno.test("isToolResultError - JSON with falsy error field", () => {
  assertEquals(isToolResultError(JSON.stringify({ error: null })), false);
  assertEquals(isToolResultError(JSON.stringify({ error: "" })), false);
  assertEquals(isToolResultError(JSON.stringify({ error: 0 })), false);
  assertEquals(isToolResultError(JSON.stringify({ error: false })), false);
});

Deno.test("isToolResultError - Validator warning prefix with success", () => {
  const content = '[VALIDATOR WARNING: This operation modifies security settings]\n\n{"result": "Security group rule added", "groupId": "sg-123"}';
  assertEquals(isToolResultError(content), false);
});

Deno.test("isToolResultError - Validator warning prefix with error", () => {
  const content = '[VALIDATOR WARNING: High risk operation]\n\n{"error": "AccessDenied: Insufficient permissions"}';
  assertEquals(isToolResultError(content), true);
});

Deno.test("isToolResultError - Validator warning prefix with non-JSON success", () => {
  const content = '[VALIDATOR WARNING: Modifies production resources]\n\nOperation completed successfully';
  assertEquals(isToolResultError(content), false);
});

Deno.test("isToolResultError - Validator warning prefix with truncated result", () => {
  const content = '[VALIDATOR WARNING: Large response]\n\n{"buckets": [{"name": "bucket1"}, {"name": "bucket2"}... (truncated)';
  assertEquals(isToolResultError(content), false);
});

Deno.test("isToolResultError - Non-JSON error patterns", () => {
  assertEquals(isToolResultError('{"error": "failed"'), true); // Malformed JSON starting with {"error"
  assertEquals(isToolResultError('Error: Something went wrong'), true);
  assertEquals(isToolResultError('Tool dispatch error from aws-agent-scanner (401)'), true);
  assertEquals(isToolResultError('AccessDenied: User lacks permission'), true);
  assertEquals(isToolResultError('Unauthorized access'), true);
});

Deno.test("isToolResultError - Non-JSON success patterns", () => {
  assertEquals(isToolResultError('Operation completed successfully'), false);
  assertEquals(isToolResultError('Found 5 buckets'), false);
  assertEquals(isToolResultError('Security group sg-12345 modified'), false);
  assertEquals(isToolResultError('{"result": "ok"} (truncated)'), false);
  assertEquals(isToolResultError('123401234567'), false); // Account IDs
});

Deno.test("isToolResultError - Edge cases", () => {
  assertEquals(isToolResultError(''), false);
  assertEquals(isToolResultError('   '), false);
  assertEquals(isToolResultError('null'), false);
  assertEquals(isToolResultError('undefined'), false);
});

Deno.test("isToolResultError - Real-world examples", () => {
  // Real success case from execute_aws_api
  const s3Success = '{"Buckets": [{"Name": "my-bucket", "CreationDate": "2024-01-01T00:00:00.000Z"}]}';
  assertEquals(isToolResultError(s3Success), false);

  // Real error case from tool dispatch
  const dispatchError = '{"error": "Tool dispatch error from aws-agent-scanner (401). Conflicting API keys"}';
  assertEquals(isToolResultError(dispatchError), true);

  // Real AccessDenied from AWS
  const awsError = '{"error": "AccessDenied: User: arn:aws:iam::123456789012:user/test is not authorized to perform: s3:ListBuckets"}';
  assertEquals(isToolResultError(awsError), true);

  // HIGH_RISK call with validator warning and success
  const highRiskSuccess = '[VALIDATOR WARNING: This operation will modify security group rules in production]\n\n{"result": "Rule added successfully", "ruleId": "sgr-12345"}';
  assertEquals(isToolResultError(highRiskSuccess), false);

  // HIGH_RISK call with validator warning and error
  const highRiskError = '[VALIDATOR WARNING: This operation modifies IAM policies]\n\n{"error": "Throttling: Rate exceeded"}';
  assertEquals(isToolResultError(highRiskError), true);
});
