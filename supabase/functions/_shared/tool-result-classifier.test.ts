/**
 * Tests for tool result error classification
 * Run with: deno test --allow-env tool-result-classifier.test.ts
 * 
 * Comprehensive test coverage for PR #51 + error-classifier merge
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isToolResultError, extractToolResultError, analyzeToolResults, classifyError } from "./tool-result-classifier.ts";

// ── Basic Error Detection (from PR #51) ────────────────────────────────────

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

// ── Validator Warning Handling (from PR #51) ───────────────────────────────

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

// ── New: Nested AWS Error Structures ───────────────────────────────────────

Deno.test("isToolResultError - Nested AWS error result.Error.Code", () => {
  assertEquals(isToolResultError(JSON.stringify({
    result: { Error: { Code: "NoSuchBucket", Message: "The bucket does not exist" } }
  })), true);
});

Deno.test("isToolResultError - Nested AWS error with success wrapper", () => {
  assertEquals(isToolResultError(JSON.stringify({
    success: false,
    result: { Error: { Code: "AccessDenied", Message: "Access denied" } }
  })), true);
});

// ── New: Status Field Detection ────────────────────────────────────────────

Deno.test("isToolResultError - status: failed", () => {
  assertEquals(isToolResultError(JSON.stringify({ status: "failed", message: "Operation failed" })), true);
});

Deno.test("isToolResultError - status: error", () => {
  assertEquals(isToolResultError(JSON.stringify({ status: "error", details: "Something went wrong" })), true);
});

Deno.test("isToolResultError - status: preview_only is NOT an error", () => {
  assertEquals(isToolResultError(JSON.stringify({
    status: "preview_only",
    message: "Preview generated",
    rule: { threshold: 200 }
  })), false);
});

// ── New: errorCode Field Detection ─────────────────────────────────────────

Deno.test("isToolResultError - errorCode field", () => {
  assertEquals(isToolResultError(JSON.stringify({
    errorCode: "InvalidParameter",
    errorMessage: "Invalid parameter value"
  })), true);
});

// ── New: AWS SDK $metadata Detection ───────────────────────────────────────

Deno.test("isToolResultError - $metadata with 400+ status", () => {
  assertEquals(isToolResultError(JSON.stringify({
    $metadata: { httpStatusCode: 403 },
    message: "Forbidden"
  })), true);
  
  assertEquals(isToolResultError(JSON.stringify({
    $metadata: { httpStatusCode: 404 },
    Code: "NoSuchEntity"
  })), true);
});

Deno.test("isToolResultError - $metadata with 200 status", () => {
  assertEquals(isToolResultError(JSON.stringify({
    $metadata: { httpStatusCode: 200 },
    Buckets: []
  })), false);
});

// ── Non-JSON Error Patterns ────────────────────────────────────────────────

Deno.test("isToolResultError - Non-JSON error patterns", () => {
  assertEquals(isToolResultError('{"error": "failed"'), true); // Malformed JSON starting with {"error"
  assertEquals(isToolResultError('Error: Something went wrong'), true);
  assertEquals(isToolResultError('Tool dispatch error from aws-agent-scanner (401)'), true);
  assertEquals(isToolResultError('AccessDenied: User lacks permission'), true);
  assertEquals(isToolResultError('Unauthorized access'), true);
  assertEquals(isToolResultError('User is not authorized to perform s3:ListBuckets'), true);
  assertEquals(isToolResultError('InvalidClientTokenId'), true);
  assertEquals(isToolResultError('ExpiredToken: Token has expired'), true);
});

Deno.test("isToolResultError - Non-JSON success patterns", () => {
  assertEquals(isToolResultError('Operation completed successfully'), false);
  assertEquals(isToolResultError('Found 5 buckets'), false);
  assertEquals(isToolResultError('Security group sg-12345 modified'), false);
});

// ── Edge Cases ──────────────────────────────────────────────────────────────

Deno.test("isToolResultError - Edge cases", () => {
  assertEquals(isToolResultError(''), false);
  assertEquals(isToolResultError('   '), false);
  assertEquals(isToolResultError('null'), false);
  assertEquals(isToolResultError('undefined'), false);
});

// ── Real-World Examples ────────────────────────────────────────────────────

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

  // Cost rule preview (NOT an error)
  const previewResult = '{"status": "preview_only", "message": "Cost rule preview generated", "rule": {"threshold": 200}}';
  assertEquals(isToolResultError(previewResult), false);
});

// ── Error Classification Tests ──────────────────────────────────────────────

Deno.test("classifyError - Platform dispatch errors", () => {
  const result = classifyError({ message: "Tool dispatch error" }, "dispatch");
  assertEquals(result.errorClass, "PLATFORM_DISPATCH");
  assertEquals(result.isRetryable, false);
});

Deno.test("classifyError - AWS auth errors", () => {
  const result1 = classifyError({ code: "InvalidClientTokenId" });
  assertEquals(result1.errorClass, "AWS_AUTH");
  
  const result2 = classifyError({ message: "ExpiredToken: Token expired" });
  assertEquals(result2.errorClass, "AWS_AUTH");
});

Deno.test("classifyError - AWS access denied", () => {
  const result = classifyError({ code: "AccessDenied", message: "User is not authorized" });
  assertEquals(result.errorClass, "AWS_ACCESS_DENIED");
});

Deno.test("classifyError - CloudPilot auth required", () => {
  const result = classifyError({ message: "Authentication is required for drift baseline management." });
  assertEquals(result.errorClass, "CLOUDPILOT_AUTH_REQUIRED");
});

// ── extractToolResultError Tests ───────────────────────────────────────────

Deno.test("extractToolResultError - Extracts from JSON content", () => {
  const result = {
    toolCallId: "call_123",
    content: JSON.stringify({ error: "AccessDenied", message: "Access denied" })
  };
  
  const extracted = extractToolResultError(result);
  assertEquals(extracted?.errorClass, "AWS_ACCESS_DENIED");
  assertEquals(typeof extracted?.message, "string");
});

Deno.test("extractToolResultError - Handles nested AWS error", () => {
  const result = {
    content: JSON.stringify({
      result: { Error: { Code: "NoSuchBucket", Message: "Bucket not found" } }
    })
  };
  
  const extracted = extractToolResultError(result);
  assertEquals(extracted?.errorClass, "AWS_NOT_FOUND");
});

Deno.test("extractToolResultError - Uses explicit errorClass", () => {
  const result = {
    content: JSON.stringify({
      errorClass: "PLATFORM_DISPATCH",
      error: "Internal error",
      service: "aws-agent-scanner"
    })
  };
  
  const extracted = extractToolResultError(result);
  assertEquals(extracted?.errorClass, "PLATFORM_DISPATCH");
  assertEquals(extracted?.service, "aws-agent-scanner");
});

Deno.test("extractToolResultError - Returns null for success", () => {
  const result = {
    content: JSON.stringify({ Buckets: [], status: "ok" })
  };
  
  assertEquals(extractToolResultError(result), null);
});

// ── analyzeToolResults Tests ────────────────────────────────────────────────

Deno.test("analyzeToolResults - Mixed success and failure", () => {
  const results = [
    { content: JSON.stringify({ Buckets: [] }) },
    { content: JSON.stringify({ error: "AccessDenied" }) },
    { content: JSON.stringify({ Users: [] }) },
  ];
  
  const analysis = analyzeToolResults(results);
  assertEquals(analysis.total, 3);
  assertEquals(analysis.successes, 2);
  assertEquals(analysis.errors, 1);
  assertEquals(analysis.allFailed, false);
  assertEquals(analysis.errorClass, "AWS_ACCESS_DENIED");
});

Deno.test("analyzeToolResults - All failed", () => {
  const results = [
    { content: JSON.stringify({ error: "Tool dispatch error" }) },
    { content: JSON.stringify({ error: "AccessDenied" }) },
  ];
  
  const analysis = analyzeToolResults(results);
  assertEquals(analysis.allFailed, true);
  assertEquals(analysis.errors, 2);
  assertEquals(analysis.successes, 0);
});

Deno.test("analyzeToolResults - All success", () => {
  const results = [
    { content: JSON.stringify({ Buckets: [] }) },
    { content: JSON.stringify({ Groups: [] }) },
  ];
  
  const analysis = analyzeToolResults(results);
  assertEquals(analysis.allFailed, false);
  assertEquals(analysis.errors, 0);
  assertEquals(analysis.successes, 2);
});
