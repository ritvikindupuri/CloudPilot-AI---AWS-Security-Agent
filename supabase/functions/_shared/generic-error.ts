/**
 * Generic client-facing errors. Log details server-side only.
 */

export const GENERIC_ERRORS = {
  unauthorized: "Authentication required.",
  forbidden: "You do not have permission to perform this action.",
  badRequest: "Invalid request.",
  notFound: "Resource not found.",
  rateLimited: "Rate limit exceeded. Try again later.",
  internal: "An internal error occurred. Please try again.",
  misconfigured: "Server is misconfigured. Contact an administrator.",
  awsFailed: "The AWS request could not be completed.",
  accessDenied: "AWS denied this request. Check IAM permissions on the connected role.",
  vaultUnavailable: "Credential vault is unavailable.",
  approvalRequired: "This change requires explicit approval in the CloudPilot UI.",
  approvalInvalid: "Approval is missing, expired, or does not match this action.",
  mutationBlocked: "This AWS operation is blocked by CloudPilot security policy.",
  credentialsRequired: "Connect an AWS account before using the agent.",
  legacyKeysDisabled: "Long-lived AWS access keys are disabled. Connect with a cross-account IAM role.",
} as const;

export function logInternalError(scope: string, err: unknown): void {
  const e = err as { name?: string; message?: string; code?: string; stack?: string };
  console.error(`[${scope}]`, e?.name || "Error", e?.code || "", e?.message || String(err));
}

export function clientErrorBody(
  message: keyof typeof GENERIC_ERRORS | string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const text = (GENERIC_ERRORS as Record<string, string>)[message] || message;
  return { error: text, ...extra };
}
