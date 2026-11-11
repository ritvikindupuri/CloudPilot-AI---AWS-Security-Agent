/**
 * Server-side pending AWS mutation approvals.
 * Approval is a UI click against a stored record (user + action hash + expiry),
 * never chat confirmation text. The stored credential/account is bound into
 * the hash so approve cannot be redirected to a different account.
 */

import { hashActionPayload, normalizeOperation } from "./aws-command-policy.ts";

function canonicalActionParts(input: {
  service: string;
  operation: string;
  params: unknown;
  toolName?: string;
  credentialId?: string | null;
  accountId?: string | null;
  region?: string | null;
}) {
  return {
    service: String(input.service || "").trim().toUpperCase(),
    operation: normalizeOperation(input.operation).toLowerCase(),
    params: input.params || {},
    toolName: input.toolName || "execute_aws_api",
    credentialId: input.credentialId || null,
    accountId: input.accountId || null,
    region: input.region || null,
  };
}

function buildSummary(input: {
  service: string;
  operation: string;
  accountId?: string | null;
  region?: string | null;
  params: unknown;
}): string {
  const account = input.accountId || "unknown-account";
  const region = input.region || "unknown-region";
  return `${input.service}.${input.operation} → account ${account} (${region})`;
}

export const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

export interface PendingActionInput {
  userId: string;
  service: string;
  operation: string;
  params: unknown;
  conversationId?: string | null;
  toolName?: string;
  credentialId?: string | null;
  accountId?: string | null;
  region?: string | null;
}

export async function createPendingAction(
  supabaseAdmin: any,
  input: PendingActionInput,
): Promise<{ id: string; actionHash: string; expiresAt: string; summary: string }> {
  const actionHash = await hashActionPayload(canonicalActionParts({
    service: input.service,
    operation: input.operation,
    params: input.params || {},
    toolName: input.toolName || "execute_aws_api",
    credentialId: input.credentialId,
    accountId: input.accountId,
    region: input.region,
  }));
  const expiresAt = new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString();
  const summary = buildSummary({
    service: input.service,
    operation: input.operation,
    accountId: input.accountId,
    region: input.region,
    params: input.params,
  });

  const { data, error } = await supabaseAdmin
    .from("pending_aws_actions")
    .insert({
      user_id: input.userId,
      service: input.service,
      operation: input.operation,
      action_hash: actionHash,
      params: input.params || {},
      tool_name: input.toolName || "execute_aws_api",
      conversation_id: input.conversationId || null,
      status: "pending",
      expires_at: expiresAt,
      summary,
      credential_id: input.credentialId || null,
      account_id: input.accountId || null,
      region: input.region || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Failed to store pending approval");
  }

  return { id: data.id, actionHash, expiresAt, summary };
}

export function pendingToolResult(pending: { id: string; summary: string; expiresAt: string }, extra: Record<string, unknown> = {}) {
  return {
    pendingApproval: true,
    approvalId: pending.id,
    summary: pending.summary,
    expiresAt: pending.expiresAt,
    message: "This mutating AWS call was not executed. Approve it in the CloudPilot pending-changes panel. Chat text such as 'confirm' is not an authorization.",
    ...extra,
  };
}

export async function consumeApprovedAction(
  supabaseAdmin: any,
  opts: {
    userId: string;
    approvalId: string;
    service?: string;
    operation?: string;
    params?: unknown;
    toolName?: string;
  },
): Promise<{ ok: true; params: unknown; record: any } | { ok: false; reason: string }> {
  const { data, error } = await supabaseAdmin
    .from("pending_aws_actions")
    .select("*")
    .eq("id", opts.approvalId)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: "Approval record not found" };
  }
  if (data.status !== "approved") {
    return { ok: false, reason: "Action has not been approved in the UI" };
  }
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "Approval has expired" };
  }

  const storedHash = await hashActionPayload(canonicalActionParts({
    service: data.service,
    operation: data.operation,
    params: data.params || {},
    toolName: data.tool_name || "execute_aws_api",
    credentialId: data.credential_id,
    accountId: data.account_id,
    region: data.region,
  }));
  if (data.action_hash !== storedHash) {
    return { ok: false, reason: "Approval does not match this action" };
  }

  if (opts.service || opts.operation) {
    const expectedHash = await hashActionPayload(canonicalActionParts({
      service: opts.service || data.service,
      operation: opts.operation || data.operation,
      params: opts.params !== undefined ? opts.params : (data.params || {}),
      toolName: opts.toolName || data.tool_name || "execute_aws_api",
      credentialId: data.credential_id,
      accountId: data.account_id,
      region: data.region,
    }));
    if (data.action_hash !== expectedHash) {
      return { ok: false, reason: "Approval does not match this action" };
    }
  }

  const { data: consumed, error: updateError } = await supabaseAdmin
    .from("pending_aws_actions")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", opts.approvalId)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();

  if (updateError || !consumed) {
    return { ok: false, reason: "Approval could not be consumed" };
  }

  return { ok: true, params: data.params, record: data };
}

export async function approvePendingAction(
  supabaseAdmin: any,
  opts: { userId: string; approvalId: string },
): Promise<{ ok: true; record: any } | { ok: false; reason: string }> {
  const { data, error } = await supabaseAdmin
    .from("pending_aws_actions")
    .select("*")
    .eq("id", opts.approvalId)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "Approval record not found" };
  if (data.status !== "pending") return { ok: false, reason: "Action is not pending" };
  if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false, reason: "Approval has expired" };

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("pending_aws_actions")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", opts.approvalId)
    .eq("status", "pending")
    .select("*")
    .single();

  if (updateError || !updated) return { ok: false, reason: "Approval could not be saved" };
  return { ok: true, record: updated };
}

export async function rejectPendingAction(
  supabaseAdmin: any,
  opts: { userId: string; approvalId: string },
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("pending_aws_actions")
    .update({ status: "rejected", rejected_at: new Date().toISOString() })
    .eq("id", opts.approvalId)
    .eq("user_id", opts.userId)
    .eq("status", "pending");
  return !error;
}
