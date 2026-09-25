/**
 * Tool Result Error Classification and Analysis
 * Merged from PR #51's tool-result-classifier.ts and error-classifier.ts
 * 
 * Provides:
 * 1. Error detection in tool results (with validator warning handling)
 * 2. Error classification by type (AWS, platform, auth, etc.)
 * 3. Batch result analysis
 * 4. User-friendly error guidance
 */

export type ErrorClass =
  | "PLATFORM_DISPATCH"      // Internal service error
  | "CLOUDPILOT_AUTH_REQUIRED" // User authentication required
  | "AWS_AUTH"               // AWS credential issue
  | "AWS_ACCESS_DENIED"      // AWS permission issue
  | "AWS_VALIDATION"         // AWS API validation error
  | "AWS_NOT_FOUND"          // Resource not found
  | "AWS_THROTTLED"          // Rate limiting
  | "AWS_RETRYABLE"          // Temporary AWS error
  | "AWS_NON_RETRYABLE"      // Permanent AWS error
  | "DUPLICATE_CALL"         // Duplicate tool call skipped
  | "UNKNOWN";

export interface ClassifiedError {
  errorClass: ErrorClass;
  message: string;
  isRetryable: boolean;
  userActionRequired: string;
}

/**
 * Determines if a tool result represents an error.
 * 
 * Updated from PR #51 to handle:
 * - Nested AWS errors: {result: {Error: {Code, Message}}}
 * - Status fields: {status: "failed"} or {status: "error"}
 * - errorCode fields
 * - $metadata.httpStatusCode >= 400
 * - Validator warning prefix: [VALIDATOR WARNING: ...]
 * - Non-JSON error text
 * - preview_only is NOT an error
 * 
 * @param resultContent - The content string from a tool result
 * @returns true if the result represents an error, false otherwise
 */
export function isToolResultError(resultContent: string): boolean {
  if (!resultContent || resultContent.trim().length === 0) {
    return false;
  }

  // Strip [VALIDATOR WARNING: ...] prefix if present
  let content = resultContent;
  const validatorWarningMatch = resultContent.match(/^\[VALIDATOR WARNING:.*?\]\n\n/s);
  if (validatorWarningMatch) {
    content = resultContent.slice(validatorWarningMatch[0].length);
  }

  // Try parsing as JSON
  try {
    const parsed = JSON.parse(content);
    
    // preview_only status is NOT an error
    if (parsed.status === "preview_only") {
      return false;
    }
    
    // Check for error indicators
    if (parsed.error) return true;
    if (parsed.status === "failed" || parsed.status === "error") return true;
    if (parsed.errorCode) return true;
    
    // Check for nested AWS error structure
    if (parsed.result?.Error?.Code) return true;
    
    // Check for AWS SDK $metadata with error status
    if (parsed.$metadata?.httpStatusCode && parsed.$metadata.httpStatusCode >= 400) return true;
    
    return false;
  } catch {
    // Not valid JSON, check non-JSON error patterns
  }

  // For non-JSON content, check if it clearly looks like an error
  const errorPatterns = [
    /^\{"error"/i,           // Starts with {"error"
    /^Error:/i,              // Starts with "Error:"
    /^Tool dispatch error/i, // Tool dispatch errors
    /AccessDenied/i,         // AWS AccessDenied errors (anywhere in string)
    /is not authorized to perform/i, // AWS auth errors
    /UnauthorizedOperation/i, // AWS unauth errors
    /^Unauthorized/i,        // Unauthorized errors
    /InvalidClientTokenId/i, // AWS credential errors
    /ExpiredToken/i,         // AWS token errors
  ];

  for (const pattern of errorPatterns) {
    if (content.trim().match(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Classify an error by type and provide user guidance
 */
export function classifyError(error: any, context?: string): ClassifiedError {
  const errorCode = String(error?.code || error?.Code || error?.name || "");
  const errorMessage = String(error?.message || error?.Message || error || "");
  const statusCode = Number(error?.statusCode || error?.$metadata?.httpStatusCode || 0);

  // Platform dispatch errors
  if (context?.includes("dispatch") || errorMessage.includes("Tool dispatch error")) {
    return {
      errorClass: "PLATFORM_DISPATCH",
      message: errorMessage,
      isRetryable: false,
      userActionRequired: "This is a CloudPilot internal service error. No action needed from you. Your AWS credentials were not used. Please try again, and if the issue persists, contact support.",
    };
  }

  // CloudPilot auth required (user-scoped tools)
  if (errorMessage.includes("Authentication is required for") || 
      errorMessage.includes("User authentication required")) {
    return {
      errorClass: "CLOUDPILOT_AUTH_REQUIRED",
      message: errorMessage,
      isRetryable: false,
      userActionRequired: "This operation requires you to be signed in to CloudPilot. Please sign in and try again.",
    };
  }

  // AWS Authentication errors
  const authErrors = [
    "InvalidClientTokenId",
    "UnrecognizedClientException",
    "ExpiredToken",
    "ExpiredTokenException",
    "SignatureDoesNotMatch",
    "InvalidAccessKeyId",
  ];
  if (authErrors.some(e => errorCode.includes(e) || errorMessage.includes(e))) {
    return {
      errorClass: "AWS_AUTH",
      message: errorMessage,
      isRetryable: false,
      userActionRequired: "Your AWS credentials are invalid or expired. Please re-authenticate your AWS account in the credentials panel.",
    };
  }

  // AWS Access Denied / Authorization
  const accessDeniedPatterns = [
    "AccessDenied",
    "AccessDeniedException",
    "UnauthorizedOperation",
    "Forbidden",
    "is not authorized to perform",
  ];
  if (accessDeniedPatterns.some(e => errorCode.includes(e) || errorMessage.includes(e)) || statusCode === 403) {
    return {
      errorClass: "AWS_ACCESS_DENIED",
      message: errorMessage,
      isRetryable: false,
      userActionRequired: "Your AWS credentials lack the required IAM permissions for this operation. Grant the necessary permissions and try again.",
    };
  }

  // AWS Validation errors
  const validationErrors = ["ValidationError", "ValidationException", "InvalidParameterValue", "InvalidParameter"];
  if (validationErrors.some(e => errorCode.includes(e) || errorMessage.includes(e)) || statusCode === 400) {
    return {
      errorClass: "AWS_VALIDATION",
      message: errorMessage,
      isRetryable: false,
      userActionRequired: "The request parameters are invalid. Please check the resource names and try again.",
    };
  }

  // Resource not found
  const notFoundErrors = ["NoSuchEntity", "ResourceNotFound", "NotFound", "NoSuchBucket", "NoSuchKey"];
  if (notFoundErrors.some(e => errorCode.includes(e) || errorMessage.includes(e)) || statusCode === 404) {
    return {
      errorClass: "AWS_NOT_FOUND",
      message: errorMessage,
      isRetryable: false,
      userActionRequired: "The requested AWS resource was not found. Verify the resource name/ID and region.",
    };
  }

  // Throttling
  const throttleErrors = [
    "Throttling",
    "ThrottlingException",
    "TooManyRequestsException",
    "RequestLimitExceeded",
    "ProvisionedThroughputExceededException",
  ];
  if (throttleErrors.some(e => errorCode.includes(e) || errorMessage.includes(e)) || statusCode === 429) {
    return {
      errorClass: "AWS_THROTTLED",
      message: errorMessage,
      isRetryable: true,
      userActionRequired: "AWS rate limit exceeded. Automatically retrying with exponential backoff.",
    };
  }

  // Retryable AWS errors
  const retryableErrors = ["ServiceUnavailable", "InternalError", "RequestTimeout", "ECONNRESET"];
  if (retryableErrors.some(e => errorCode.includes(e) || errorMessage.includes(e)) || statusCode >= 500) {
    return {
      errorClass: "AWS_RETRYABLE",
      message: errorMessage,
      isRetryable: true,
      userActionRequired: "Temporary AWS service error. Automatically retrying.",
    };
  }

  return {
    errorClass: "UNKNOWN",
    message: errorMessage,
    isRetryable: false,
    userActionRequired: "An unexpected error occurred. Please try again.",
  };
}

/**
 * Extract error information from a tool result (with full content parsing)
 */
export function extractToolResultError(result: any): { errorClass: ErrorClass; message: string; service?: string } | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  // Parse content if it's a string
  let content = result.content;
  if (typeof content === "string") {
    // Strip validator warning prefix
    const validatorWarningMatch = content.match(/^\[VALIDATOR WARNING:.*?\]\n\n/s);
    if (validatorWarningMatch) {
      content = content.slice(validatorWarningMatch[0].length);
    }
    
    try {
      content = JSON.parse(content);
    } catch {
      // Not JSON, content stays as string
    }
  }

  if (!isToolResultError(typeof content === "string" ? content : JSON.stringify(content))) {
    return null;
  }

  // If content is still a string (non-JSON error), classify from the text
  if (typeof content === "string") {
    const classified = classifyError({ message: content }, result.service);
    return {
      errorClass: classified.errorClass,
      message: classified.message,
      service: result.service,
    };
  }

  // Content is parsed JSON
  // Check for explicit errorClass in content
  if (content.errorClass && typeof content.errorClass === "string") {
    return {
      errorClass: content.errorClass as ErrorClass,
      message: content.message || content.error || "Unknown error",
      service: content.service || result.service,
    };
  }

  // Classify from content fields
  let errorToClassify = content.error || content;
  
  // Handle nested AWS error structure
  if (content.result?.Error) {
    errorToClassify = {
      code: content.result.Error.Code,
      message: content.result.Error.Message || content.result.Error.Code,
    };
  }

  if (content.errorCode) {
    errorToClassify = {
      code: content.errorCode,
      message: content.message || content.errorMessage || content.errorCode,
    };
  }

  const classified = classifyError(errorToClassify, result.service);
  return {
    errorClass: classified.errorClass,
    message: classified.message,
    service: content.service || result.service,
  };
}

/**
 * Count errors and successes in a batch of tool results
 */
export function analyzeToolResults(results: any[]): {
  total: number;
  errors: number;
  successes: number;
  errorClass?: ErrorClass;
  allFailed: boolean;
} {
  const total = results.length;
  let errors = 0;
  let firstErrorClass: ErrorClass | undefined;

  for (const result of results) {
    const content = typeof result.content === "string" ? result.content : JSON.stringify(result.content || result);
    if (isToolResultError(content)) {
      errors++;
      if (!firstErrorClass) {
        const extracted = extractToolResultError(result);
        if (extracted) {
          firstErrorClass = extracted.errorClass;
        }
      }
    }
  }

  return {
    total,
    errors,
    successes: total - errors,
    errorClass: firstErrorClass,
    allFailed: errors === total && total > 0,
  };
}
