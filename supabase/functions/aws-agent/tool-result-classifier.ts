/**
 * Tool result error classification utility
 * 
 * Determines if a tool result represents an error.
 * Used by aws-agent to accurately report execution status.
 */

/**
 * Determines if a tool result represents an error.
 * 
 * Rules:
 * 1. If content parses as JSON and has a truthy `error` field, it's an error
 * 2. If content has [VALIDATOR WARNING: ...] prefix, strip it and try parsing again
 * 3. Non-JSON content is only an error if it clearly looks like an error
 * 4. Default non-JSON content to success
 * 
 * @param resultContent - The content string from a tool result
 * @returns true if the result represents an error, false otherwise
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
