/**
 * Node.js test runner for tool-result-classifier
 * Run with: node tool-result-classifier-node.test.js
 */

function isToolResultError(resultContent) {
  if (!resultContent || resultContent.trim().length === 0) {
    return false;
  }

  try {
    const content = JSON.parse(resultContent);
    return !!content.error;
  } catch {
    // Not valid JSON, continue to other checks
  }

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

  const errorPatterns = [
    /^\{"error"/i,
    /^Error:/i,
    /^Tool dispatch error/i,
    /^AccessDenied/i,
    /^Unauthorized/i,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(resultContent.trim())) {
      return true;
    }
  }

  return false;
}

// Test runner
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  ${err.message}`);
    failed++;
  }
}

function assertEquals(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${expected}, got ${actual}`);
  }
}

// Tests
test("JSON with error field", () => {
  assertEquals(isToolResultError(JSON.stringify({ error: "Something failed" })), true);
  assertEquals(isToolResultError(JSON.stringify({ error: "Tool dispatch error from aws-agent-scanner (401)" })), true);
  assertEquals(isToolResultError(JSON.stringify({ error: "AccessDenied" })), true);
});

test("JSON without error field", () => {
  assertEquals(isToolResultError(JSON.stringify({ result: "success", data: [] })), false);
  assertEquals(isToolResultError(JSON.stringify({ buckets: [], count: 0 })), false);
});

test("JSON with falsy error field", () => {
  assertEquals(isToolResultError(JSON.stringify({ error: null })), false);
  assertEquals(isToolResultError(JSON.stringify({ error: "" })), false);
  assertEquals(isToolResultError(JSON.stringify({ error: 0 })), false);
});

test("Validator warning with success", () => {
  const content = '[VALIDATOR WARNING: This operation modifies security settings]\n\n{"result": "Security group rule added", "groupId": "sg-123"}';
  assertEquals(isToolResultError(content), false);
});

test("Validator warning with error", () => {
  const content = '[VALIDATOR WARNING: High risk operation]\n\n{"error": "AccessDenied: Insufficient permissions"}';
  assertEquals(isToolResultError(content), true);
});

test("Validator warning with non-JSON success (REGRESSION FIX)", () => {
  const content = '[VALIDATOR WARNING: Modifies production resources]\n\nOperation completed successfully';
  assertEquals(isToolResultError(content), false, "Non-JSON after validator warning should default to success");
});

test("Validator warning with truncated result (REGRESSION FIX)", () => {
  const content = '[VALIDATOR WARNING: Large response]\n\n{"buckets": [{"name": "bucket1"}... (truncated)';
  assertEquals(isToolResultError(content), false, "Truncated non-JSON should default to success");
});

test("Non-JSON error patterns", () => {
  assertEquals(isToolResultError('{"error": "failed"'), true);
  assertEquals(isToolResultError('Error: Something went wrong'), true);
  assertEquals(isToolResultError('Tool dispatch error from aws-agent-scanner (401)'), true);
  assertEquals(isToolResultError('AccessDenied: User lacks permission'), true);
  assertEquals(isToolResultError('Unauthorized access'), true);
});

test("Non-JSON success patterns (REGRESSION FIX)", () => {
  assertEquals(isToolResultError('Operation completed successfully'), false);
  assertEquals(isToolResultError('Found 5 buckets'), false);
  assertEquals(isToolResultError('Security group sg-12345 modified'), false);
  assertEquals(isToolResultError('{"result": "ok"} (truncated)'), false);
  assertEquals(isToolResultError('123401234567'), false, "Account IDs should not be errors");
});

test("Edge cases", () => {
  assertEquals(isToolResultError(''), false);
  assertEquals(isToolResultError('   '), false);
  assertEquals(isToolResultError('null'), false);
  assertEquals(isToolResultError('undefined'), false);
});

test("Real-world examples", () => {
  const s3Success = '{"Buckets": [{"Name": "my-bucket", "CreationDate": "2024-01-01T00:00:00.000Z"}]}';
  assertEquals(isToolResultError(s3Success), false);

  const dispatchError = '{"error": "Tool dispatch error from aws-agent-scanner (401). Conflicting API keys"}';
  assertEquals(isToolResultError(dispatchError), true);

  const awsError = '{"error": "AccessDenied: User: arn:aws:iam::123456789012:user/test is not authorized"}';
  assertEquals(isToolResultError(awsError), true);

  const highRiskSuccess = '[VALIDATOR WARNING: This operation will modify security group rules]\n\n{"result": "Rule added successfully", "ruleId": "sgr-12345"}';
  assertEquals(isToolResultError(highRiskSuccess), false, "HIGH_RISK with validator warning and success should not be error");

  const highRiskError = '[VALIDATOR WARNING: This operation modifies IAM policies]\n\n{"error": "Throttling: Rate exceeded"}';
  assertEquals(isToolResultError(highRiskError), true);
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
