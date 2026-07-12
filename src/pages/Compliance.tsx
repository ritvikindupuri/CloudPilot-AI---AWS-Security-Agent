import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  GanttChartSquare,
  HelpCircle,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { toast } from "sonner";
import {
  deriveControlTrends,
  deriveFrameworkSummaries,
  formatFrameworkKey,
  getFrameworkOptions,
  summarizeControlHealth,
  type ComplianceReportRecord,
} from "@/lib/compliance";
/* eslint-disable @typescript-eslint/no-explicit-any */
// These compliance tables may not exist in the typed schema yet
type EvidenceExportRow = any;
type ComplianceExceptionRow = any;
type ComplianceAttestationRow = any;
type ApprovalRequestRow = any;
type AuditLogRow = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const frameworkOptions = getFrameworkOptions();

const badgeTone = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized.includes("open") || normalized.includes("overdue") || normalized.includes("failed")) {
    return "bg-destructive/10 text-destructive border-destructive/30";
  }
  if (normalized.includes("approved") || normalized.includes("complete") || normalized.includes("generated")) {
    return "bg-primary/10 text-primary border-primary/30";
  }
  if (normalized.includes("review") || normalized.includes("scheduled") || normalized.includes("pending")) {
    return "bg-warning/10 text-warning border-warning/30";
  }
  return "bg-muted text-muted-foreground border-border";
};

const severityTone = (value: string) => {
  const normalized = value.toLowerCase();
  if (normalized === "critical" || normalized === "high") return "bg-destructive/10 text-destructive border-destructive/30";
  if (normalized === "medium") return "bg-warning/10 text-warning border-warning/30";
  return "bg-primary/10 text-primary border-primary/30";
};

const scoreTone = (score: number | null) => {
  if (score === null) return "text-muted-foreground";
  if (score >= 85) return "text-primary";
  if (score >= 65) return "text-warning";
  return "text-destructive";
};

const truncate = (value: string, max = 180) => (value.length > max ? `${value.slice(0, max)}...` : value);

const downloadBlob = (filename: string, type: string, content: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const Compliance = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [reports, setReports] = useState<ComplianceReportRecord[]>([]);
  const [exports, setExports] = useState<EvidenceExportRow[]>([]);
  const [exceptions, setExceptions] = useState<ComplianceExceptionRow[]>([]);
  const [attestations, setAttestations] = useState<ComplianceAttestationRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [selectedFramework, setSelectedFramework] = useState<string>("all");
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [exceptionForm, setExceptionForm] = useState({
    framework: "soc2",
    control_id: "",
    title: "",
    justification: "",
    severity: "medium",
    owner_email: "",
    expires_at: "",
  });
  const [attestationForm, setAttestationForm] = useState({
    framework: "soc2",
    title: "",
    control_scope: "all_controls",
    cadence: "quarterly",
    owner_email: "",
    due_at: "",
    notes: "",
  });

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setLoading(true);

      const [{ data: conversations }, { data: exportRows }, { data: exceptionRows }, { data: attestationRows }, { data: approvalRows }, { data: auditRows }] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from("conversations" as any).select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false }) as any),
        (supabase.from("compliance_evidence_exports" as any).select("*").order("created_at", { ascending: false }) as any),
        (supabase.from("compliance_exceptions" as any).select("*").order("created_at", { ascending: false }) as any),
        (supabase.from("compliance_attestations" as any).select("*").order("due_at", { ascending: true }) as any),
        (supabase.from("approval_requests" as any).select("*").order("created_at", { ascending: false }).limit(40) as any),
        (supabase.from("agent_audit_log").select("*").order("created_at", { ascending: false }).limit(80) as any),
      ]);

      let reportRows: ComplianceReportRecord[] = [];
      if (conversations && conversations.length > 0) {
        const conversationMap = new Map<string, string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conversations.forEach((conversation: any) => conversationMap.set(conversation.id, conversation.title));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conversationIds = conversations.map((conversation: any) => conversation.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: messages } = await (supabase.from("messages" as any).select("id, content, created_at, conversation_id").eq("role", "assistant").in("conversation_id", conversationIds).order("created_at", { ascending: false }) as any);

        reportRows =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (messages as any[] | null)?.map((message) => ({
            id: message.id,
            content: message.content,
            created_at: message.created_at,
            conversation_id: message.conversation_id,
            conversation_title: conversationMap.get(message.conversation_id) || "Untitled",
          })) ?? [];
      }

      setReports(reportRows);
      setExports((exportRows ?? []) as any);
      setExceptions((exceptionRows ?? []) as any);
      setAttestations((attestationRows ?? []) as any);
      setApprovals((approvalRows ?? []) as any);
      setAuditLogs((auditRows ?? []) as any);
      setLoading(false);
    };

    loadData();
  }, [user]);

  useEffect(() => {
    if (tourStep !== null) {
      setTimeout(() => {
        const element = document.getElementById(`tour-step-${tourStep}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
    }
  }, [tourStep]);

  const filteredReports = useMemo(() => {
    if (selectedFramework === "all") return reports;
    const label = formatFrameworkKey(selectedFramework);
    return reports.filter((report) => report.content.toLowerCase().includes(selectedFramework) || report.content.toLowerCase().includes(label.toLowerCase()));
  }, [reports, selectedFramework]);

  const frameworkSummaries = useMemo(() => deriveFrameworkSummaries(filteredReports), [filteredReports]);
  const controlTrends = useMemo(() => deriveControlTrends(filteredReports).slice(-8), [filteredReports]);
  const controlHealth = useMemo(() => summarizeControlHealth(frameworkSummaries), [frameworkSummaries]);
  const openExceptions = useMemo(() => exceptions.filter((item) => item.status !== "approved" && item.status !== "expired"), [exceptions]);
  const dueAttestations = useMemo(
    () => attestations.filter((item: any) => item.status !== "completed" && new Date(item.due_at).getTime() <= Date.now() + 1000 * 60 * 60 * 24 * 30),
    [attestations],
  );
  const approvalBacklog = useMemo(() => approvals.filter((item) => item.status.includes("pending")), [approvals]);

  const filteredExceptions = useMemo(
    () => (selectedFramework === "all" ? exceptions : exceptions.filter((item) => item.framework === selectedFramework)),
    [exceptions, selectedFramework],
  );

  const filteredAttestations = useMemo(
    () => (selectedFramework === "all" ? attestations : attestations.filter((item) => item.framework === selectedFramework)),
    [attestations, selectedFramework],
  );

  const handleCreateException = async () => {
    if (!user || !exceptionForm.control_id.trim() || !exceptionForm.title.trim() || !exceptionForm.justification.trim()) {
      toast.error("Add a control ID, title, and justification before saving the exception.");
      return;
    }

    const payload: any = {
      user_id: user.id,
      framework: exceptionForm.framework,
      control_id: exceptionForm.control_id.trim(),
      title: exceptionForm.title.trim(),
      justification: exceptionForm.justification.trim(),
      severity: exceptionForm.severity,
      owner_email: exceptionForm.owner_email.trim() || null,
      expires_at: exceptionForm.expires_at ? new Date(exceptionForm.expires_at).toISOString() : null,
      metadata: {},
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase.from("compliance_exceptions" as any).insert(payload).select("*").single() as any);
    if (error || !data) {
      toast.error("Failed to create exception.");
      return;
    }

    setExceptions((prev: any) => [data, ...prev]);
    setExceptionForm({
      framework: exceptionForm.framework,
      control_id: "",
      title: "",
      justification: "",
      severity: "medium",
      owner_email: "",
      expires_at: "",
    });
    toast.success("Exception added to the compliance workspace.");
  };

  const handleCreateAttestation = async () => {
    if (!user || !attestationForm.title.trim() || !attestationForm.due_at) {
      toast.error("Add a title and due date before scheduling an attestation.");
      return;
    }

    const payload: any = {
      user_id: user.id,
      framework: attestationForm.framework,
      title: attestationForm.title.trim(),
      control_scope: attestationForm.control_scope.trim() || "all_controls",
      cadence: attestationForm.cadence,
      owner_email: attestationForm.owner_email.trim() || null,
      due_at: new Date(attestationForm.due_at).toISOString(),
      notes: attestationForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase.from("compliance_attestations" as any).insert(payload).select("*").single() as any);
    if (error || !data) {
      toast.error("Failed to schedule attestation.");
      return;
    }

    setAttestations((prev: any) => [...prev, data].sort((a: any, b: any) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()));
    setAttestationForm({
      framework: attestationForm.framework,
      title: "",
      control_scope: "all_controls",
      cadence: "quarterly",
      owner_email: "",
      due_at: "",
      notes: "",
    });
    toast.success("Attestation scheduled.");
  };

  const handleExceptionStatus = async (row: ComplianceExceptionRow, status: string) => {
    const { data, error } = await (supabase
      .from("compliance_exceptions" as any)
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single() as any);

    if (error || !data) {
      toast.error("Failed to update exception status.");
      return;
    }

    setExceptions((prev) => prev.map((item) => (item.id === row.id ? data : item)));
  };

  const handleAttestationStatus = async (row: ComplianceAttestationRow, status: string) => {
    const updatePayload: any = {
      status,
      updated_at: new Date().toISOString(),
      last_completed_at: status === "completed" ? new Date().toISOString() : row.last_completed_at,
    };

    const { data, error } = await (supabase
      .from("compliance_attestations" as any)
      .update(updatePayload)
      .eq("id", row.id)
      .select("*")
      .single() as any);

    if (error || !data) {
      toast.error("Failed to update attestation.");
      return;
    }

    setAttestations((prev) => prev.map((item) => (item.id === row.id ? data : item)));
  };

  const handleAuditorExport = async () => {
    if (!user) return;
    setExporting(true);

    try {
      const evidenceBundle = {
        generatedAt: new Date().toISOString(),
        filter: selectedFramework,
        frameworks: frameworkSummaries.map((item) => ({
          framework: item.label,
          reportsCount: item.reportsCount,
          passSignals: item.passSignals,
          failSignals: item.failSignals,
          notApplicableSignals: item.notApplicableSignals,
          score: item.score,
          latestSeenAt: item.latestSeenAt,
        })),
        controlTrends,
        reports: filteredReports.map((report) => ({
          id: report.id,
          title: report.conversation_title,
          created_at: report.created_at,
          excerpt: truncate(report.content, 400),
        })),
        exceptions: filteredExceptions,
        attestations: filteredAttestations,
        approvals: approvalBacklog,
        auditLogSummary: auditLogs.slice(0, 40),
      };

      const encoded = new TextEncoder().encode(JSON.stringify(evidenceBundle));
      const digest = await crypto.subtle.digest("SHA-256", encoded);
      const evidenceHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

      const insertPayload: any = {
        user_id: user.id,
        title: `Auditor export ${new Date().toLocaleString()}`,
        export_type: "auditor_bundle",
        status: "generated",
        evidence_hash: evidenceHash,
        evidence_bundle: evidenceBundle,
        filters: {
          framework: selectedFramework,
          reports: filteredReports.length,
          exceptions: filteredExceptions.length,
          attestations: filteredAttestations.length,
        },
      };

      const { data, error } = await (supabase.from("compliance_evidence_exports" as any).insert(insertPayload).select("*").single() as any);
      if (error || !data) {
        toast.error("Failed to store auditor bundle.");
        return;
      }

      setExports((prev) => [data, ...prev]);

      const csvRows = [
        ["Framework", "Reports", "Pass Signals", "Fail Signals", "Not Applicable", "Score"],
        ...frameworkSummaries.map((item) => [item.label, String(item.reportsCount), String(item.passSignals), String(item.failSignals), String(item.notApplicableSignals), item.score === null ? "" : String(item.score)]),
      ];
      const csv = csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

      downloadBlob(`cloudpilot-auditor-bundle-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(insertPayload, null, 2));
      downloadBlob(`cloudpilot-framework-summary-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8", csv);
      toast.success("Auditor bundle exported.");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CloudPilotLogo className="w-8 h-8 text-primary" />
          <p className="text-sm text-muted-foreground">Loading compliance workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/70 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono text-muted-foreground tracking-widest uppercase">Compliance Command Center</p>
            <h1 className="text-2xl font-bold text-foreground mt-1">Audit workspace and evidence operations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Turn CloudPilot reports into framework dashboards, exception queues, scheduled attestations, and auditor-ready exports.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Select value={selectedFramework} onValueChange={setSelectedFramework}>
              <SelectTrigger className="w-[180px] bg-muted border-border">
                <SelectValue placeholder="Filter framework" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All frameworks</SelectItem>
                {frameworkOptions.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setTourStep(1)} className="border-primary/50 text-primary hover:bg-primary/10">
              <HelpCircle className="w-4 h-4 mr-2" />
              Start Tour
            </Button>
            <Button variant="outline" size="sm" onClick={handleAuditorExport} disabled={exporting}>
              <Download className="w-4 h-4 mr-2" />
              {exporting ? "Exporting..." : "Auditor Export"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/operations">
                <GanttChartSquare className="w-4 h-4 mr-2" />
                Operations
              </Link>
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
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div id="tour-step-1" className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 transition-all duration-300 ${tourStep === 1 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background p-1 rounded-xl shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
          {[
            { label: "Frameworks Covered", value: frameworkSummaries.filter((item) => item.reportsCount > 0).length, icon: ShieldCheck },
            { label: "Report Library", value: filteredReports.length, icon: FileText },
            { label: "Evidence Exports", value: exports.length, icon: FileSpreadsheet },
            { label: "Open Exceptions", value: openExceptions.length, icon: ShieldAlert },
            { label: "Due Attestations", value: dueAttestations.length, icon: CalendarClock },
            { label: "Pending Approvals", value: approvalBacklog.length, icon: ClipboardCheck },
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

        <section className="grid grid-cols-1 xl:grid-cols-[1.5fr,1fr] gap-6">
          <div id="tour-step-2" className={`rounded-xl border border-border bg-card p-5 transition-all duration-300 ${tourStep === 2 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  Framework Dashboard
                </p>
                <h2 className="text-lg font-semibold text-foreground mt-1">Control posture by framework</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Derived from existing CloudPilot reports. Scores use pass/fail signals extracted from report content and should be treated as workspace telemetry, not a signed audit opinion.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono">
                {selectedFramework === "all" ? "Portfolio View" : formatFrameworkKey(selectedFramework)}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
              {frameworkSummaries.map((item) => (
                <div key={item.key} className="rounded-xl border border-border bg-background/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {item.reportsCount > 0 ? `${item.reportsCount} report${item.reportsCount === 1 ? "" : "s"} contribute to this view` : "No reports mapped yet"}
                      </p>
                    </div>
                    <span className={`text-2xl font-bold ${scoreTone(item.score)}`}>{item.score === null ? "--" : `${item.score}%`}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                    <div className="rounded-lg bg-primary/10 border border-primary/20 px-2 py-3">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase">Pass</p>
                      <p className="text-lg font-semibold text-foreground mt-1">{item.passSignals}</p>
                    </div>
                    <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-2 py-3">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase">Fail</p>
                      <p className="text-lg font-semibold text-foreground mt-1">{item.failSignals}</p>
                    </div>
                    <div className="rounded-lg bg-muted border border-border px-2 py-3">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase">N/A</p>
                      <p className="text-lg font-semibold text-foreground mt-1">{item.notApplicableSignals}</p>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    {item.latestSeenAt ? `Last evidence ${formatDistanceToNow(new Date(item.latestSeenAt), { addSuffix: true })}` : "Awaiting first mapped report"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div id="tour-step-3" className={`rounded-xl border border-border bg-card p-5 transition-all duration-300 ${tourStep === 3 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Control Trend</p>
            <h2 className="text-lg font-semibold text-foreground mt-1">Pass / fail signal trend</h2>
            <p className="text-sm text-muted-foreground mt-1">Recent report activity across the filtered compliance scope.</p>

            <div className="grid grid-cols-3 gap-3 mt-5">
              <div className="rounded-xl border border-border bg-background/60 p-4">
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Pass Signals</p>
                <p className="text-2xl font-semibold text-foreground mt-2">{controlHealth.passSignals}</p>
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-4">
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Fail Signals</p>
                <p className="text-2xl font-semibold text-foreground mt-2">{controlHealth.failSignals}</p>
              </div>
              <div className="rounded-xl border border-border bg-background/60 p-4">
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Not Applicable</p>
                <p className="text-2xl font-semibold text-foreground mt-2">{controlHealth.notApplicableSignals}</p>
              </div>
            </div>

            <div className="space-y-4 mt-5">
              {controlTrends.length === 0 ? (
                <p className="text-sm text-muted-foreground">Run or archive compliance-focused reports to populate the control trend timeline.</p>
              ) : (
                controlTrends.map((point) => {
                  const total = point.passCount + point.failCount + point.notApplicableCount || 1;
                  return (
                    <div key={point.id}>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                        <span>{point.label}</span>
                        <span>{point.passCount + point.failCount + point.notApplicableCount} signals</span>
                      </div>
                      <div className="flex h-3 overflow-hidden rounded-full border border-border bg-muted">
                        <div className="bg-primary" style={{ width: `${(point.passCount / total) * 100}%` }} />
                        <div className="bg-destructive" style={{ width: `${(point.failCount / total) * 100}%` }} />
                        <div className="bg-muted-foreground/40" style={{ width: `${(point.notApplicableCount / total) * 100}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div id="tour-step-4" className={`rounded-xl border border-border bg-card p-5 space-y-4 transition-all duration-300 ${tourStep === 4 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Exception Management</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Risk-accepted control gaps</h2>
              <p className="text-sm text-muted-foreground mt-1">Track approved deviations, owners, and expiry dates for auditors and internal reviewers.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select value={exceptionForm.framework} onValueChange={(value) => setExceptionForm((prev) => ({ ...prev, framework: value }))}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Framework" />
                </SelectTrigger>
                <SelectContent>
                  {frameworkOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={exceptionForm.control_id}
                onChange={(event) => setExceptionForm((prev) => ({ ...prev, control_id: event.target.value }))}
                placeholder="Control ID (e.g. CC6.1)"
                className="bg-muted border-border"
              />
              <Input
                value={exceptionForm.title}
                onChange={(event) => setExceptionForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Exception title"
                className="bg-muted border-border md:col-span-2"
              />
              <Textarea
                value={exceptionForm.justification}
                onChange={(event) => setExceptionForm((prev) => ({ ...prev, justification: event.target.value }))}
                placeholder="Business justification and compensating controls"
                className="bg-muted border-border md:col-span-2 min-h-[96px]"
              />
              <Select value={exceptionForm.severity} onValueChange={(value) => setExceptionForm((prev) => ({ ...prev, severity: value }))}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={exceptionForm.owner_email}
                onChange={(event) => setExceptionForm((prev) => ({ ...prev, owner_email: event.target.value }))}
                placeholder="Owner email"
                className="bg-muted border-border"
              />
              <Input
                type="date"
                value={exceptionForm.expires_at}
                onChange={(event) => setExceptionForm((prev) => ({ ...prev, expires_at: event.target.value }))}
                className="bg-muted border-border"
              />
              <Button onClick={handleCreateException} className="md:justify-self-start">
                Save Exception
              </Button>
            </div>

            <div className="space-y-3">
              {filteredExceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exceptions recorded for the selected scope.</p>
              ) : (
                filteredExceptions.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-background/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{item.title}</p>
                          <Badge variant="outline" className={badgeTone(item.status)}>
                            {item.status}
                          </Badge>
                          <Badge variant="outline" className={severityTone(item.severity)}>
                            {item.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatFrameworkKey(item.framework)} · {item.control_id}
                          {item.owner_email ? ` · ${item.owner_email}` : ""}
                        </p>
                      </div>
                      <Select value={item.status} onValueChange={(value) => handleExceptionStatus(item, value)}>
                        <SelectTrigger className="w-[150px] bg-muted border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="under_review">Under Review</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="expired">Expired</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">{truncate(item.justification)}</p>
                    <p className="text-xs text-muted-foreground mt-3">
                      {item.expires_at ? `Expires ${new Date(item.expires_at).toLocaleDateString()}` : "No expiry set"} · Updated {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div id="tour-step-5" className={`rounded-xl border border-border bg-card p-5 space-y-4 transition-all duration-300 ${tourStep === 5 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Scheduled Attestations</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Recurring review calendar</h2>
              <p className="text-sm text-muted-foreground mt-1">Assign owners, due dates, and cadence for recurring audit sign-offs.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select value={attestationForm.framework} onValueChange={(value) => setAttestationForm((prev) => ({ ...prev, framework: value }))}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Framework" />
                </SelectTrigger>
                <SelectContent>
                  {frameworkOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={attestationForm.title}
                onChange={(event) => setAttestationForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Attestation title"
                className="bg-muted border-border"
              />
              <Input
                value={attestationForm.control_scope}
                onChange={(event) => setAttestationForm((prev) => ({ ...prev, control_scope: event.target.value }))}
                placeholder="Control scope"
                className="bg-muted border-border"
              />
              <Select value={attestationForm.cadence} onValueChange={(value) => setAttestationForm((prev) => ({ ...prev, cadence: value }))}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Cadence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semiannual">Semiannual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={attestationForm.owner_email}
                onChange={(event) => setAttestationForm((prev) => ({ ...prev, owner_email: event.target.value }))}
                placeholder="Owner email"
                className="bg-muted border-border"
              />
              <Input
                type="date"
                value={attestationForm.due_at}
                onChange={(event) => setAttestationForm((prev) => ({ ...prev, due_at: event.target.value }))}
                className="bg-muted border-border"
              />
              <Textarea
                value={attestationForm.notes}
                onChange={(event) => setAttestationForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Review notes or required evidence"
                className="bg-muted border-border md:col-span-2 min-h-[96px]"
              />
              <Button onClick={handleCreateAttestation} className="md:justify-self-start">
                Schedule Attestation
              </Button>
            </div>

            <div className="space-y-3">
              {filteredAttestations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attestations scheduled for the selected scope.</p>
              ) : (
                filteredAttestations.map((item) => {
                  const overdue = item.status !== "completed" && new Date(item.due_at) < new Date();
                  return (
                    <div key={item.id} className="rounded-xl border border-border bg-background/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground">{item.title}</p>
                            <Badge variant="outline" className={badgeTone(overdue ? "overdue" : item.status)}>
                              {overdue ? "overdue" : item.status}
                            </Badge>
                            <Badge variant="outline">{item.cadence}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatFrameworkKey(item.framework)} · Due {new Date(item.due_at).toLocaleDateString()}
                            {item.owner_email ? ` · ${item.owner_email}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleAttestationStatus(item, "completed")}>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Complete
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleAttestationStatus(item, "scheduled")}>
                            Reset
                          </Button>
                        </div>
                      </div>
                      {item.notes && <p className="text-sm text-muted-foreground mt-3">{truncate(item.notes)}</p>}
                      <p className="text-xs text-muted-foreground mt-3">
                        {item.last_completed_at ? `Last completed ${new Date(item.last_completed_at).toLocaleDateString()}` : "No completion recorded yet"}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.25fr,1fr] gap-6">
          <div id="tour-step-6" className={`rounded-xl border border-border bg-card p-5 space-y-4 transition-all duration-300 ${tourStep === 6 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Auditor Exports</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Immutable evidence bundle history</h2>
              <p className="text-sm text-muted-foreground mt-1">Each export stores a hash, filters, and the structured evidence payload used to build the download package.</p>
            </div>

            <div className="space-y-3">
              {exports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence bundles have been exported yet.</p>
              ) : (
                exports.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-xl border border-border bg-background/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{item.title}</p>
                          <Badge variant="outline" className={badgeTone(item.status)}>
                            {item.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.export_type} · Generated {new Date(item.generated_at).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          downloadBlob(
                            `cloudpilot-evidence-${item.id.slice(0, 8)}.json`,
                            "application/json",
                            JSON.stringify(item.evidence_bundle, null, 2),
                          )
                        }
                      >
                        <Download className="w-4 h-4 mr-2" />
                        JSON
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 break-all">SHA-256: {item.evidence_hash}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div id="tour-step-7" className={`rounded-xl border border-border bg-card p-5 space-y-4 transition-all duration-300 ${tourStep === 7 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Recent Evidence Trail</p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Approvals and AWS call audit stream</h2>
              <p className="text-sm text-muted-foreground mt-1">Useful for audit walkthroughs when you need to prove who approved what and what AWS calls backed the reports.</p>
            </div>

            <div className="space-y-3">
              {approvalBacklog.slice(0, 3).map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-background/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.operation_name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{truncate(item.summary, 110)}</p>
                    </div>
                    <Badge variant="outline" className={badgeTone(item.status)}>
                      {item.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {auditLogs.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-background/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.aws_service}:{item.aws_operation}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(item.created_at).toLocaleString()} · {item.aws_region}</p>
                    </div>
                    <Badge variant="outline" className={badgeTone(item.status)}>
                      {item.status}
                    </Badge>
                  </div>
                  {item.error_message && <p className="text-xs text-destructive mt-2">{truncate(item.error_message, 100)}</p>}
                </div>
              ))}
              {approvalBacklog.length === 0 && auditLogs.length === 0 && (
                <p className="text-sm text-muted-foreground">No approvals or AWS audit activity available yet.</p>
              )}
            </div>
          </div>
        </section>

        <section id="tour-step-8" className={`rounded-xl border border-border bg-card p-5 transition-all duration-300 ${tourStep === 8 ? "relative z-40 ring-4 ring-primary ring-offset-4 ring-offset-background shadow-[0_0_30px_rgba(var(--primary),0.55)] scale-[1.01] bg-primary/5" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                Source Reports
              </p>
              <h2 className="text-lg font-semibold text-foreground mt-1">Compliance-ready report library</h2>
              <p className="text-sm text-muted-foreground mt-1">These assistant reports feed the framework and trend views above.</p>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">
              {filteredReports.length} reports in scope
            </Badge>
          </div>

          <div className="mt-5 space-y-3">
            {filteredReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reports matched the current compliance filter.</p>
            ) : (
              filteredReports.slice(0, 8).map((report) => (
                <Link
                  key={report.id}
                  to={`/report/${report.id}`}
                  className="block rounded-xl border border-border bg-background/60 p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{report.conversation_title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(report.created_at).toLocaleString()}</p>
                    </div>
                    <span className="text-xs text-primary">Open report</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">{truncate(report.content)}</p>
                </Link>
              ))
            )}
          </div>
        </section>
      </main>

      {tourStep !== null && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-30 transition-all duration-300" />
      )}

      {tourStep !== null && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-card/95 border border-primary/30 max-w-md w-full shadow-2xl p-6 rounded-2xl backdrop-blur-md animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-mono bg-primary/10 text-primary px-2.5 py-0.5 rounded border border-primary/20 uppercase tracking-wider">
                  Compliance Step {tourStep} of 8
                </span>
                <h4 className="font-extrabold text-lg text-foreground mt-3 tracking-tight">
                  {tourStep === 1 && "📊 Compliance Metrics"}
                  {tourStep === 2 && "🛡️ Control Posture Dashboard"}
                  {tourStep === 3 && "📈 Pass / Fail Signal Trend"}
                  {tourStep === 4 && "🛑 Deviation Exceptions Queue"}
                  {tourStep === 5 && "📅 Attestation Calendar"}
                  {tourStep === 6 && "📁 Auditor Evidence Exports"}
                  {tourStep === 7 && "🔍 Recent Validation Trail"}
                  {tourStep === 8 && "📚 Mapped Report Library"}
                </h4>
              </div>
              <button 
                onClick={() => setTourStep(null)}
                className="text-muted-foreground hover:text-foreground text-xs p-1"
                aria-label="Close tour"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 my-4">
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-primary uppercase tracking-widest">What it does</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {tourStep === 1 && "Displays portfolios covered, report library count, evidence exports history, open risk exceptions, and due attestations."}
                  {tourStep === 2 && "Calculates automated compliance scores for frameworks (SOC2, HIPAA, PCI-DSS) by mapping controls to agent findings."}
                  {tourStep === 3 && "Tracks historical security scan signals, rendering compliance health trends over time."}
                  {tourStep === 4 && "Provides a repository to log compensating security controls and temporary compliance deviations for auditor review."}
                  {tourStep === 5 && "Manages recurring control sign-offs, cadences (quarterly/monthly), owners, and notes."}
                  {tourStep === 6 && "Lists generated evidence archives complete with cryptographically secure SHA-256 validation hashes."}
                  {tourStep === 7 && "Consolidates approvals and direct AWS call logs into an audit-friendly validation trail."}
                  {tourStep === 8 && "Contains full reports generated by the agent during security chat queries that feed this compliance dashboard."}
                </p>
              </div>

              <div className="bg-primary/5 border border-primary/25 rounded-lg p-3 space-y-1.5 font-mono">
                <p className="text-[9px] uppercase tracking-widest text-primary font-bold">Interactive Try-this-Prompt</p>
                <p className="text-[11px] text-foreground font-medium italic">
                  {tourStep === 1 && '"List all S3 bucket settings that fail SOC2 compliance rules"'}
                  {tourStep === 2 && '"Map my AWS configuration checks to the HIPAA security rulebook"'}
                  {tourStep === 3 && 'Ask the agent to execute a baseline scan to trigger trend data.'}
                  {tourStep === 4 && '"Log a HIPAA exception for bucket logging on dev-bucket"'}
                  {tourStep === 5 && '"Add a quarterly attestation for review of bucket public blocks"'}
                  {tourStep === 6 && 'Click the "Auditor Export" button at the top header to compile CSV/JSON.'}
                  {tourStep === 7 && 'Instruct the agent to perform checks to populate the validation logs.'}
                  {tourStep === 8 && '"Draft a SOC2 security review for IAM group permissions"'}
                </p>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-border mt-4">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setTourStep(null)}
                className="text-xs text-muted-foreground"
              >
                Skip Walkthrough
              </Button>
              <div className="flex gap-2">
                {tourStep > 1 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setTourStep(prev => prev ? prev - 1 : null)}
                    className="text-xs"
                  >
                    Back
                  </Button>
                )}
                <Button 
                  size="sm" 
                  onClick={() => {
                    if (tourStep < 8) {
                      setTourStep(prev => prev ? prev + 1 : null);
                    } else {
                      setTourStep(null);
                    }
                  }}
                  className="text-xs"
                >
                  {tourStep === 8 ? "Finish" : "Next"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Compliance;
