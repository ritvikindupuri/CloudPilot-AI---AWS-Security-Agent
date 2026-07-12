import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckSquare, Clock, Download, FileText, Globe, Layers3, Lock, PlayCircle, RefreshCcw, Shield, ShieldCheck, SlidersHorizontal, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface GuardianCredentialRow {
  id: string;
  label: string;
  account_id: string | null;
  guardian_enabled: boolean;
  last_scan_at: string | null;
  last_scan_status: string | null;
}

interface EventPolicyRow {
  id: string;
  name: string;
  trigger_event: string;
  risk_threshold: string;
  response_type: string;
  response_action: string;
  notify_channels: unknown;
  is_active: boolean;
  raw_query: string;
  created_at: string;
}

interface CostRuleRow {
  id: string;
  rule_id: string;
  rule_type: string;
  threshold: number | null;
  multiplier: number | null;
  scope: string;
  action: string;
  requires_confirm: boolean;
  created_at: string;
}

interface DriftEventRow {
  id: string;
  severity: string;
  title: string;
  resource_id: string;
  detected_at: string;
  resolved: boolean;
}

interface SnapshotRow {
  id: string;
  resource_type: string;
  captured_at: string;
  is_baseline: boolean;
}

interface RunbookExecutionRow {
  id: string;
  runbook_name: string;
  status: string;
  dry_run: boolean;
  current_step_index: number;
  last_error: string | null;
  updated_at: string;
}

interface RunbookStepRow {
  id: string;
  execution_id: string;
  step_name: string;
  step_order: number;
  status: string;
  risk: string;
  output: string | null;
  updated_at: string;
}

interface OrgHistoryRow {
  id: string;
  action: string;
  scope: string;
  scp_template: string | null;
  account_count: number;
  env_breakdown: Record<string, number> | null;
  warnings: string[] | null;
  blocked: string[] | null;
  rollback_plan: string | null;
  status: string;
  created_at: string;
}

interface AutomationRunRow {
  id: string;
  source: string;
  mode: string;
  status: string;
  account_id: string | null;
  summary: Record<string, unknown> | null;
  created_at: string;
}

interface GuardianEventActivityRow {
  id: string;
  event_name: string;
  risk_level: string;
  actor_arn: string | null;
  resource_id: string | null;
  resource_type: string | null;
  region: string | null;
  created_at: string;
  matched_policies: unknown;
  auto_fixes: unknown;
  notifications: unknown;
  runbooks: unknown;
}

interface ApprovalRequestRow {
  id: string;
  request_key: string;
  operation_name: string;
  summary: string;
  risk_level: string;
  required_approvals: number;
  current_approvals: number;
  dual_approval_required: boolean;
  status: string;
  last_approved_at: string | null;
  executed_at: string | null;
  created_at: string;
}

interface ApprovalActionRow {
  id: string;
  approval_request_id: string;
  approver_user_id: string;
  decision: string;
  created_at: string;
}

interface ComplianceEvidenceExportRow {
  id: string;
  title: string;
  export_type: string;
  status: string;
  evidence_hash: string;
  evidence_bundle: Record<string, unknown> | null;
  created_at: string;
  generated_at: string;
}

interface AuditLogRow {
  id: string;
  aws_service: string;
  aws_operation: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

const badgeClass = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("failed") || normalized.includes("blocked")) {
    return "bg-destructive/10 text-destructive border-destructive/30";
  }
  if (normalized.includes("high") || normalized.includes("waiting") || normalized.includes("partial")) {
    return "bg-orange-500/10 text-orange-400 border-orange-500/30";
  }
  if (normalized.includes("medium") || normalized.includes("preview")) {
    return "bg-warning/10 text-warning border-warning/30";
  }
  if (normalized.includes("completed") || normalized.includes("executed") || normalized.includes("success") || normalized.includes("active")) {
    return "bg-primary/10 text-primary border-primary/30";
  }
  return "bg-muted text-muted-foreground border-border";
};

const toChannels = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

const summarizeMatchedPolicies = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") return item.name;
      return null;
    })
    .filter((item): item is string => Boolean(item));
};

const summarizeAutoFixState = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      label: "NO AUTO-FIX",
      className: badgeClass("inactive"),
      detail: "No automatic remediation was attempted.",
    };
  }

  const items = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const appliedCount = items.filter((item) => item.applied === true).length;
  const suppressedCount = items.filter((item) => item.skipped === true || item.applied === false).length;

  if (appliedCount > 0) {
    return {
      label: "AUTO-FIX APPLIED",
      className: badgeClass("success"),
      detail: `${appliedCount} automatic remediation action${appliedCount === 1 ? "" : "s"} applied${suppressedCount > 0 ? `, ${suppressedCount} suppressed` : ""}.`,
    };
  }

  return {
    label: "AUTO-FIX SUPPRESSED",
    className: badgeClass("blocked"),
    detail: `${suppressedCount} automatic remediation action${suppressedCount === 1 ? "" : "s"} suppressed by policy guardrails.`,
  };
};

const Operations = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [eventPolicies, setEventPolicies] = useState<EventPolicyRow[]>([]);
  const [costRules, setCostRules] = useState<CostRuleRow[]>([]);
  const [driftEvents, setDriftEvents] = useState<DriftEventRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [runbookExecutions, setRunbookExecutions] = useState<RunbookExecutionRow[]>([]);
  const [runbookSteps, setRunbookSteps] = useState<RunbookStepRow[]>([]);
  const [orgHistory, setOrgHistory] = useState<OrgHistoryRow[]>([]);
  const [localCreds, setLocalCreds] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("cloudpilot-aws-credentials");
      return saved && saved !== "undefined" ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [automationRuns, setAutomationRuns] = useState<AutomationRunRow[]>([]);
  const [eventActivity, setEventActivity] = useState<GuardianEventActivityRow[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequestRow[]>([]);
  const [approvalActions, setApprovalActions] = useState<ApprovalActionRow[]>([]);
  const [evidenceExports, setEvidenceExports] = useState<ComplianceEvidenceExportRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [editingPolicy, setEditingPolicy] = useState<EventPolicyRow | null>(null);
  const [policyForm, setPolicyForm] = useState({
    name: "",
    trigger_event: "",
    risk_threshold: "MEDIUM",
    response_type: "notify",
    response_action: "",
    notify_channels: "",
  });

  const loadData = async () => {
    if (!user) return;
    const [
      policiesResp,
      costResp,
      driftResp,
      snapshotsResp,
      runbooksResp,
      orgResp,
      guardianResp,
      automationRunsResp,
      eventActivityResp,
      approvalRequestsResp,
      approvalActionsResp,
      evidenceExportsResp,
      auditLogsResp,
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("event_response_policies" as any).select("*").order("created_at", { ascending: false }).limit(25) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("cost_automation_rules" as any).select("*").order("created_at", { ascending: false }).limit(25) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("drift_events" as any).select("*").order("detected_at", { ascending: false }).limit(25) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("resource_snapshots" as any).select("*").eq("is_baseline", true).order("captured_at", { ascending: false }).limit(100) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("runbook_executions" as any).select("*").order("updated_at", { ascending: false }).limit(15) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("org_operation_history" as any).select("*").order("created_at", { ascending: false }).limit(20) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("stored_aws_credentials" as any).select("id, label, account_id, guardian_enabled, last_scan_at, last_scan_status").eq("guardian_enabled", true) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("automation_runs" as any).select("*").order("created_at", { ascending: false }).limit(20) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("guardian_event_activity" as any).select("*").order("created_at", { ascending: false }).limit(20) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("approval_requests" as any).select("*").order("updated_at", { ascending: false }).limit(20) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("approval_actions" as any).select("*").order("created_at", { ascending: false }).limit(100) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("compliance_evidence_exports" as any).select("*").order("created_at", { ascending: false }).limit(20) as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("agent_audit_log" as any).select("id, aws_service, aws_operation, status, error_message, created_at").order("created_at", { ascending: false }).limit(40) as any),
    ]);

    setEventPolicies((policiesResp.data || []) as unknown as EventPolicyRow[]);
    setCostRules((costResp.data || []) as unknown as CostRuleRow[]);
    setDriftEvents((driftResp.data || []) as unknown as DriftEventRow[]);
    setSnapshots((snapshotsResp.data || []) as unknown as SnapshotRow[]);
    const executions = (runbooksResp.data || []) as unknown as RunbookExecutionRow[];
    setRunbookExecutions(executions);
    setOrgHistory((orgResp.data || []) as unknown as OrgHistoryRow[]);
    setGuardianCreds((guardianResp.data || []) as unknown as GuardianCredentialRow[]);
    setAutomationRuns((automationRunsResp.data || []) as unknown as AutomationRunRow[]);
    setEventActivity((eventActivityResp.data || []) as unknown as GuardianEventActivityRow[]);
    setApprovalRequests((approvalRequestsResp.data || []) as ApprovalRequestRow[]);
    setApprovalActions((approvalActionsResp.data || []) as ApprovalActionRow[]);
    setEvidenceExports((evidenceExportsResp.data || []) as ComplianceEvidenceExportRow[]);
    setAuditLogs((auditLogsResp.data || []) as AuditLogRow[]);
    setAutomationRuns((automationRunsResp.data || []) as unknown as AutomationRunRow[]);
    setEventActivity((eventActivityResp.data || []) as unknown as GuardianEventActivityRow[]);
    setApprovalRequests((approvalRequestsResp.data || []) as unknown as ApprovalRequestRow[]);
    setApprovalActions((approvalActionsResp.data || []) as unknown as ApprovalActionRow[]);
    setEvidenceExports((evidenceExportsResp.data || []) as unknown as ComplianceEvidenceExportRow[]);
    setAuditLogs((auditLogsResp.data || []) as unknown as AuditLogRow[]);

    const executionIds = executions.map((execution) => execution.id);
    if (executionIds.length > 0) {

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stepsResp = await (supabase
        .from("runbook_execution_steps" as any)
        .select("*")
        .in("execution_id", executionIds)
        .order("step_order", { ascending: true }) as any);
      setRunbookSteps((stepsResp.data || []) as unknown as RunbookStepRow[]);
    } else {
      setRunbookSteps([]);
    }
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const refresh = () => {
      loadData();
    };

    const channel = supabase
      .channel("operations-control-plane")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_response_policies" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cost_automation_rules" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "resource_snapshots" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "drift_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "runbook_executions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "runbook_execution_steps" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "org_operation_history" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "stored_aws_credentials" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_runs" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "guardian_event_activity" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_actions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "compliance_evidence_exports" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_audit_log" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const baselineSummary = useMemo(() => {
    const baselineResources = snapshots.length;
    const lastBaselineCapture = snapshots[0]?.captured_at || null;
    const unresolvedDrift = driftEvents.filter((event) => !event.resolved).length;
    const lastDrift = driftEvents[0]?.detected_at || null;
    return { baselineResources, lastBaselineCapture, unresolvedDrift, lastDrift };
  }, [snapshots, driftEvents]);

  const stepsByExecution = useMemo(() => {
    const map = new Map<string, RunbookStepRow[]>();
    for (const step of runbookSteps) {
      const existing = map.get(step.execution_id) || [];
      existing.push(step);
      map.set(step.execution_id, existing);
    }
    return map;
  }, [runbookSteps]);

  const approvalActionsByRequest = useMemo(() => {
    const map = new Map<string, ApprovalActionRow[]>();
    for (const action of approvalActions) {
      const existing = map.get(action.approval_request_id) || [];
      existing.push(action);
      map.set(action.approval_request_id, existing);
    }
    return map;
  }, [approvalActions]);

  const pendingApprovals = useMemo(
    () => approvalRequests.filter((request) => request.status !== "executed" && request.status !== "failed"),
    [approvalRequests],
  );

  const immutableTimeline = useMemo(() => {
    const approvalEntries = approvalRequests.map((request) => ({
      id: `approval-${request.id}`,
      timestamp: request.created_at,
      title: request.summary,
      detail: `Approval workflow · ${request.current_approvals}/${request.required_approvals} approval(s) · ${request.status}`,
      status: request.status,
    }));
    const auditEntries = auditLogs.map((log) => ({
      id: `audit-${log.id}`,
      timestamp: log.created_at,
      title: `${log.aws_service}.${log.aws_operation}`,
      detail: log.error_message || `Audit record status: ${log.status}.`,
      status: log.status,
    }));
    const eventEntries = eventActivity.map((event) => ({
      id: `event-${event.id}`,
      timestamp: event.created_at,
      title: `CloudTrail ${event.event_name}`,
      detail: `${event.resource_id || "Unknown resource"} · ${event.risk_level}`,
      status: event.risk_level,
    }));
    const runbookEntries = runbookExecutions.map((execution) => ({
      id: `runbook-${execution.id}`,
      timestamp: execution.updated_at,
      title: execution.runbook_name,
      detail: `Runbook execution · ${execution.status}`,
      status: execution.status,
    }));
    const orgEntries = orgHistory.map((entry) => ({
      id: `org-${entry.id}`,
      timestamp: entry.created_at,
      title: entry.scp_template || entry.action,
      detail: `Organization rollout · ${entry.account_count} account(s) · ${entry.status}`,
      status: entry.status,
    }));

    return [...approvalEntries, ...auditEntries, ...eventEntries, ...runbookEntries, ...orgEntries]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30);
  }, [approvalRequests, auditLogs, eventActivity, runbookExecutions, orgHistory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const handleTogglePolicy = async (policy: EventPolicyRow, nextValue: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("event_response_policies" as any).update({ is_active: nextValue } as any).eq("id", policy.id) as any);
    setEventPolicies((prev) => prev.map((item) => item.id === policy.id ? { ...item, is_active: nextValue } : item));
  };

  const openEditPolicy = (policy: EventPolicyRow) => {
    setEditingPolicy(policy);
    setPolicyForm({
      name: policy.name,
      trigger_event: policy.trigger_event,
      risk_threshold: policy.risk_threshold,
      response_type: policy.response_type,
      response_action: policy.response_action,
      notify_channels: toChannels(policy.notify_channels).join(", "),
    });
  };

  const handleSavePolicy = async () => {
    if (!editingPolicy) return;
    const notifyChannels = policyForm.notify_channels
      .split(",")
      .map((channel) => channel.trim())
      .filter(Boolean);


    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase
      .from("event_response_policies" as any)
      .update({
        name: policyForm.name,
        trigger_event: policyForm.trigger_event,
        risk_threshold: policyForm.risk_threshold,
        response_type: policyForm.response_type,
        response_action: policyForm.response_action,
        notify_channels: notifyChannels,
      } as any)
      .eq("id", editingPolicy.id) as any);

    setEventPolicies((prev) =>
      prev.map((item) =>
        item.id === editingPolicy.id
          ? {
              ...item,
              name: policyForm.name,
              trigger_event: policyForm.trigger_event,
              risk_threshold: policyForm.risk_threshold,
              response_type: policyForm.response_type,
              response_action: policyForm.response_action,
              notify_channels: notifyChannels,
            }
          : item,
      ),
    );
    setEditingPolicy(null);
  };

  const handleGenerateEvidenceExport = async () => {
    if (!user) return;

    const evidenceBundle = {
      generatedAt: new Date().toISOString(),
      approvals: approvalRequests,
      approvalActions,
      auditLogs,
      driftEvents,
      runbookExecutions,
      runbookSteps,
      orgHistory,
      automationRuns,
      eventActivity,
    };

    const encoded = new TextEncoder().encode(JSON.stringify(evidenceBundle));
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    const evidenceHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

    const insertPayload = {
      user_id: user.id,
      title: `Compliance evidence export ${new Date().toLocaleString()}`,
      export_type: "audit_timeline",
      status: "generated",
      evidence_hash: evidenceHash,
      evidence_bundle: evidenceBundle,
      filters: {
        approvals: approvalRequests.length,
        audits: auditLogs.length,
        drift: driftEvents.length,
        runbooks: runbookExecutions.length,
        orgOperations: orgHistory.length,
        eventActivity: eventActivity.length,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("compliance_evidence_exports" as any) as any).insert(insertPayload);

    const blob = new Blob([JSON.stringify(insertPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cloudpilot-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/70 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono text-muted-foreground tracking-widest uppercase">Operations Control Plane</p>
            <h1 className="text-2xl font-bold text-foreground mt-1">CloudPilot automation management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage event policies, automations, baselines, runbooks, and organization rollouts from one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCcw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/reports">
                <FileText className="w-4 h-4 mr-2" />
                Reports
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/app">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Chat
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {[
            { label: "Event Policies", value: eventPolicies.length, icon: Shield },
            { label: "Cost Rules", value: costRules.length, icon: TrendingUp },
            { label: "Unresolved Drift", value: baselineSummary.unresolvedDrift, icon: Layers3 },
            { label: "Runbooks", value: runbookExecutions.length, icon: PlayCircle },
            { label: "Pending Approvals", value: pendingApprovals.length, icon: CheckSquare },
            { label: "Evidence Exports", value: evidenceExports.length, icon: FileText },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">{item.label}</p>
                  <p className="text-3xl font-bold text-foreground mt-2">{item.value}</p>
                </div>
                <item.icon className="w-5 h-5 text-primary" />
              </div>
            </div>
          ))}
        </div>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Active Operations Connection
            </p>
            <h2 className="text-lg font-semibold text-foreground mt-1">Active Security Agent Session</h2>
            <p className="text-sm text-muted-foreground mt-1">Status of your temporary, zero-storage connection held in browser memory.</p>
          </div>

          <div>
            {localCreds ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 max-w-md">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <p className="font-semibold text-sm text-foreground">AWS Account Session</p>
                    {localCreds.roleArn ? (
                      <p className="text-[10px] font-mono text-muted-foreground truncate max-w-[280px]" title={localCreds.roleArn}>
                        Role: {localCreds.roleArn}
                      </p>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        Access Key: {localCreds.accessKeyId ? `***${localCreds.accessKeyId.slice(-4)}` : "Ephemeral Access Key"}
                      </p>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    CONNECTED
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div className="space-y-1 bg-background/50 p-2 rounded border border-border">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Globe className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-mono">Region</span>
                    </div>
                    <p className="text-xs font-medium truncate">
                      {localCreds.region || "us-east-1"}
                    </p>
                  </div>
                  <div className="space-y-1 bg-background/50 p-2 rounded border border-border">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[10px] uppercase font-mono">Storage</span>
                    </div>
                    <p className="text-xs font-medium text-emerald-400">
                      Zero-Storage (Session)
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/50">
                  <p className="text-[11px] text-muted-foreground">
                    This session is active. All security audits, cost checks, and runbook triggers run in real time directly against this connection.
                  </p>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-lg p-8 text-center max-w-lg">
                <ShieldCheck className="w-8 h-8 text-muted-foreground/60 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-foreground">No Active AWS Connection</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Connect your AWS account via the main console to enable real-time audits, threat analysis, and automated compliance tracking.
                </p>
                <Button size="sm" className="mt-4" asChild>
                  <Link to="/app">Go to Console</Link>
                </Button>
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Security Findings</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Active drift & security issues</h2>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading active findings...</p>
              ) : driftEvents.filter((event) => !event.resolved).length === 0 ? (
                <p className="text-sm text-muted-foreground">No unresolved security group or resource drift findings detected.</p>
              ) : driftEvents.filter((event) => !event.resolved).map((event) => (
                <div key={event.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{event.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Resource: {event.resource_id} · Detected {new Date(event.detected_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(event.severity)}`}>
                      {event.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Agent Operations</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Agent execution audit log</h2>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading audit logs...</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agent executions have been recorded yet.</p>
              ) : auditLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                          {log.aws_service || "AWS"}
                        </span>
                        <p className="text-sm font-semibold text-foreground">{log.aws_operation}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {new Date(log.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${log.status === "SUCCESS" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
                      {log.status}
                    </span>
                  </div>
                  {log.error_message && (
                    <p className="text-[11px] text-destructive mt-2 bg-destructive/5 p-2 rounded border border-destructive/10 font-mono">
                      Error: {log.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Approval Workflows</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">High-risk execution approvals</h2>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading approval requests...</p>
              ) : approvalRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">No approval requests have been recorded yet.</p>
              ) : approvalRequests.map((request) => {
                const actions = approvalActionsByRequest.get(request.id) || [];
                return (
                  <div key={request.id} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{request.summary}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {request.operation_name} · Created {new Date(request.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(request.risk_level)}`}>{request.risk_level}</span>
                        <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(request.status)}`}>{request.status}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Approvals: {request.current_approvals}/{request.required_approvals} · {request.dual_approval_required ? "Dual approval required" : "Single approval flow"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Approver records: {actions.length === 0 ? "None yet" : actions.map((action) => `${action.approver_user_id.slice(0, 8)}… (${action.decision})`).join(" · ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Compliance Evidence</p>
                <h2 className="text-lg font-semibold text-foreground mt-1">Immutable export history</h2>
              </div>
              <Button variant="outline" size="sm" onClick={handleGenerateEvidenceExport}>
                <Download className="w-4 h-4 mr-2" />
                Generate Export
              </Button>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading evidence exports...</p>
              ) : evidenceExports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No compliance evidence exports have been generated yet.</p>
              ) : evidenceExports.map((item) => (
                <div key={item.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {item.export_type} · Generated {new Date(item.generated_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(item.status)}`}>{item.status}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2 break-all">
                    Evidence hash: {item.evidence_hash}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Immutable Audit Timeline</p>
            <h2 className="text-lg font-semibold text-foreground mt-1">Cross-system evidence trail</h2>
          </div>

          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading audit timeline...</p>
            ) : immutableTimeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit timeline records are available yet.</p>
            ) : immutableTimeline.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{entry.detail}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(entry.status)}`}>{entry.status}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Event Response Policies</p>
                <h2 className="text-lg font-semibold text-foreground mt-1">Rules and toggles</h2>
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading policies...</p>
              ) : eventPolicies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No event response policies have been created yet.</p>
              ) : eventPolicies.map((policy) => (
                <div key={policy.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{policy.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Trigger: {policy.trigger_event} · Risk: {policy.risk_threshold} · Response: {policy.response_type}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-2">{policy.raw_query}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(policy.is_active ? "active" : "inactive")}`}>
                        {policy.is_active ? "ACTIVE" : "PAUSED"}
                      </span>
                      <Switch checked={policy.is_active} onCheckedChange={(checked) => handleTogglePolicy(policy, checked)} />
                      <Button variant="outline" size="sm" onClick={() => openEditPolicy(policy)}>
                        <SlidersHorizontal className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Cost Automation</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Saved rules</h2>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading cost rules...</p>
              ) : costRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved cost automation rules yet.</p>
              ) : costRules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{rule.rule_id}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Type: {rule.rule_type} · Scope: {rule.scope} · Action: {rule.action}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(rule.requires_confirm ? "preview" : "executed")}`}>
                      {rule.requires_confirm ? "CONFIRM" : "AUTO"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Threshold: {rule.threshold ?? "—"} · Multiplier: {rule.multiplier ?? "—"} · Created {new Date(rule.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Baseline and Drift</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Snapshot health</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-[10px] font-mono text-muted-foreground">BASELINE RESOURCES</p>
                <p className="text-2xl font-bold text-foreground mt-1">{baselineSummary.baselineResources}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-[10px] font-mono text-muted-foreground">UNRESOLVED DRIFT</p>
                <p className="text-2xl font-bold text-foreground mt-1">{baselineSummary.unresolvedDrift}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-xs text-muted-foreground">
                Last baseline capture: {baselineSummary.lastBaselineCapture ? new Date(baselineSummary.lastBaselineCapture).toLocaleString() : "No baseline captured"}
              </p>
              <p className="text-xs text-muted-foreground">
                Last drift event: {baselineSummary.lastDrift ? new Date(baselineSummary.lastDrift).toLocaleString() : "No drift events recorded"}
              </p>
            </div>

            <div className="space-y-2">
              {(driftEvents.slice(0, 6)).map((event) => (
                <div key={event.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-foreground">{event.title}</p>
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(event.severity)}`}>{event.severity}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {event.resource_id} · {new Date(event.detected_at).toLocaleString()} · {event.resolved ? "Resolved" : "Open"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Runbook History</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Execution progress</h2>
            </div>

            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading runbook history...</p>
              ) : runbookExecutions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runbook executions recorded yet.</p>
              ) : runbookExecutions.map((execution) => {
                const steps = stepsByExecution.get(execution.id) || [];
                return (
                  <details key={execution.id} className="rounded-lg border border-border bg-muted/30 p-3">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{execution.runbook_name}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Updated {new Date(execution.updated_at).toLocaleString()} · Step {execution.current_step_index}/{Math.max(steps.length, 1)}
                          </p>
                        </div>
                        <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(execution.status)}`}>{execution.status}</span>
                      </div>
                    </summary>

                    <div className="mt-3 space-y-2">
                      {steps.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">No step history has been recorded yet for this execution.</p>
                      ) : steps.map((step) => (
                        <div key={step.id} className="rounded border border-border bg-background/70 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[12px] text-foreground">{step.step_order}. {step.step_name}</p>
                            <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(step.status)}`}>{step.status}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">{step.output || `Risk: ${step.risk}`}</p>
                        </div>
                      ))}
                      {execution.last_error && (
                        <p className="text-[11px] text-destructive">{execution.last_error}</p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Organization Operations</p>
            <h2 className="text-lg font-semibold text-foreground mt-1">Rollout history and blast radius previews</h2>
          </div>

          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading organization rollout history...</p>
            ) : orgHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organization-wide operations have been recorded yet.</p>
            ) : orgHistory.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{entry.scp_template || entry.action}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Scope: {entry.scope} · Accounts: {entry.account_count} · {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(entry.status)}`}>{entry.status}</span>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-muted-foreground">
                  <div className="rounded border border-border bg-background/70 px-3 py-2">
                    <p className="font-mono uppercase text-[10px] text-muted-foreground">Env Breakdown</p>
                    <p className="mt-1">{Object.entries(entry.env_breakdown || {}).map(([env, count]) => `${env}: ${count}`).join(" · ") || "None"}</p>
                  </div>
                  <div className="rounded border border-border bg-background/70 px-3 py-2">
                    <p className="font-mono uppercase text-[10px] text-muted-foreground">Warnings</p>
                    <p className="mt-1">{(entry.warnings || []).join(" | ") || "None"}</p>
                  </div>
                  <div className="rounded border border-border bg-background/70 px-3 py-2">
                    <p className="font-mono uppercase text-[10px] text-muted-foreground">Rollback Plan</p>
                    <p className="mt-1">{entry.rollback_plan || "Not provided"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={Boolean(editingPolicy)} onOpenChange={(open) => !open && setEditingPolicy(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit event response policy</DialogTitle>
            <DialogDescription>
              Adjust the operator-facing fields for this policy and save the changes immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input value={policyForm.name} onChange={(e) => setPolicyForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Policy name" />
            <Input value={policyForm.trigger_event} onChange={(e) => setPolicyForm((prev) => ({ ...prev, trigger_event: e.target.value }))} placeholder="Trigger event" />
            <Input value={policyForm.response_action} onChange={(e) => setPolicyForm((prev) => ({ ...prev, response_action: e.target.value }))} placeholder="Response action" />

            <div className="grid grid-cols-2 gap-3">
              <select
                value={policyForm.risk_threshold}
                onChange={(e) => setPolicyForm((prev) => ({ ...prev, risk_threshold: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>

              <select
                value={policyForm.response_type}
                onChange={(e) => setPolicyForm((prev) => ({ ...prev, response_type: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {["auto_fix", "notify", "runbook", "all"].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <Input
              value={policyForm.notify_channels}
              onChange={(e) => setPolicyForm((prev) => ({ ...prev, notify_channels: e.target.value }))}
              placeholder="Notify channels, comma separated"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPolicy(null)}>Cancel</Button>
            <Button onClick={handleSavePolicy}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Operations;
