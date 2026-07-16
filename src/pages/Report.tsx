import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Printer, Clock, AlertCircle, Loader2, Download,
  Shield, HelpCircle, Check, Copy, ChevronDown, ChevronUp,
  Layers3, AlertTriangle, ShieldCheck, Gauge, Globe, Lock,
  TrendingUp, FileText, CheckCircle
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend
} from "recharts";

interface ReportMessage {
  id: string;
  content: string;
  created_at: string;
  conversation_id: string;
}

interface ReportConversation {
  title: string;
}

interface AuditFinding {
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  resource: string;
  description?: string;
  remediation?: string;
}

interface AuditCacheResponse {
  totals: {
    findings: number;
    resourcesEvaluated: number;
    servicesAssessed: number;
    severityCounts: {
      CRITICAL: number;
      HIGH: number;
      MEDIUM: number;
      LOW: number;
      INFO: number;
    };
    overallRisk: string;
  };
  findingsForPanel?: AuditFinding[];
  servicesAssessed?: string[];
  limitations?: string[];
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#3b82f6",
  INFO: "#6b7280",
};

const calculateHealthScore = (counts: any) => {
  if (!counts) return 100;
  const critDeduct = Math.min(60, (counts.CRITICAL || 0) * 20);
  const highDeduct = Math.min(45, (counts.HIGH || 0) * 8);
  const medDeduct = Math.min(30, (counts.MEDIUM || 0) * 3);
  const lowDeduct = Math.min(15, (counts.LOW || 0) * 1);
  const score = 100 - critDeduct - highDeduct - medDeduct - lowDeduct;
  return Math.max(0, score);
};

const getFrameworks = (findingId: string, title: string) => {
  const lowercaseId = (findingId || "").toLowerCase();
  const lowercaseTitle = (title || "").toLowerCase();
  
  if (lowercaseId.includes("s3") || lowercaseTitle.includes("s3")) {
    return [
      { name: "CIS AWS v3.0", control: "2.1 (S3 Block Public Access)" },
      { name: "SOC 2 Type II", control: "CC6.3 (Access Control & Encryption)" },
      { name: "PCI-DSS v4.0", control: "1.2 (Restricting public access)" }
    ];
  }
  if (lowercaseId.includes("mfa") || lowercaseTitle.includes("mfa")) {
    return [
      { name: "CIS AWS v3.0", control: "1.5 (Multi-Factor Authentication)" },
      { name: "SOC 2 Type II", control: "CC6.3 (Credential management)" },
      { name: "PCI-DSS v4.0", control: "8.3 (MFA for administrative access)" }
    ];
  }
  if (lowercaseId.includes("sg") || lowercaseId.includes("security") || lowercaseTitle.includes("port") || lowercaseTitle.includes("security group")) {
    return [
      { name: "CIS AWS v3.0", control: "5.1 (Restrict ingress ports 22/3389)" },
      { name: "SOC 2 Type II", control: "CC6.6 (Boundary defenses)" },
      { name: "PCI-DSS v4.0", control: "1.3 (Restricting untrusted access)" }
    ];
  }
  if (lowercaseId.includes("admin") || lowercaseId.includes("privilege") || lowercaseTitle.includes("admin") || lowercaseTitle.includes("iam")) {
    return [
      { name: "CIS AWS v3.0", control: "1.16 (Least privilege IAM policies)" },
      { name: "SOC 2 Type II", control: "CC6.1 (User access authorization)" },
      { name: "PCI-DSS v4.0", control: "7.1 (Limit privilege delegation)" }
    ];
  }
  return [
    { name: "CIS AWS v3.0", control: "General Security Practice" },
    { name: "SOC 2 Type II", control: "CC6.1 (Access authorization)" }
  ];
};

const Report = () => {
  const { messageId } = useParams<{ messageId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [message, setMessage] = useState<ReportMessage | null>(null);
  const [conversation, setConversation] = useState<ReportConversation | null>(null);
  const [auditCache, setAuditCache] = useState<AuditCacheResponse | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"dashboard" | "report">("dashboard");
  const [expandedFindings, setExpandedFindings] = useState<Record<string, boolean>>({});
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const reportContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/auth?next=/report/${messageId}`, { replace: true });
      return;
    }
    if (!messageId) {
      setError("Invalid report link.");
      setLoading(false);
      return;
    }

    const loadReportAndCache = async () => {
      try {
        let msg: any = null;
        let resolvedMsgId = messageId;

        // Auto-resolve latest report if requested
        if (messageId === "latest") {
          const { data: latestMsg, error: latestMsgErr } = await (supabase
            .from("messages" as any)
            .select("id, content, created_at, conversation_id")
            .eq("role", "assistant")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle() as any);
          
          if (latestMsgErr || !latestMsg) {
            setError("No historical reports found in database.");
            setLoading(false);
            return;
          }
          msg = latestMsg;
          resolvedMsgId = latestMsg.id;
        } else {
          const { data: fetchMsg, error: msgErr } = await (supabase
            .from("messages" as any)
            .select("id, content, created_at, conversation_id")
            .eq("id", messageId)
            .single() as any);
          
          if (msgErr || !fetchMsg) {
            setError("Report not found or you don't have access to it.");
            setLoading(false);
            return;
          }
          msg = fetchMsg;
        }

        setMessage(msg as ReportMessage);

        // Fetch conversation details
        const { data: conv } = await (supabase
          .from("conversations" as any)
          .select("title")
          .eq("id", msg.conversation_id)
          .single() as any);

        if (conv) setConversation(conv as ReportConversation);

        // Fetch latest audit cache details for dashboard graphs
        const { data: cache } = await (supabase
          .from("unified_audit_cache" as any)
          .select("response, last_refreshed_at")
          .order("last_refreshed_at", { ascending: false })
          .limit(1)
          .maybeSingle() as any);

        if (cache && cache.response) {
          setAuditCache(cache.response as AuditCacheResponse);
        }
      } catch (err: any) {
        console.error("Failed to load report data:", err);
        setError("An unexpected error occurred loading report details.");
      } finally {
        setLoading(false);
      }
    };

    loadReportAndCache();
  }, [messageId, user, authLoading, navigate]);

  const toggleFinding = (id: string) => {
    setExpandedFindings(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (command: string) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    toast.success("AWS CLI command copied to clipboard!");
    setTimeout(() => setCopiedCommand(null), 2500);
  };

  const downloadPdf = useCallback(async () => {
    if (!reportContentRef.current || downloading) return;
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const ts = message ? new Date(message.created_at).toISOString().slice(0, 10) : "report";
      const opt = {
        margin: [0.5, 0.6, 0.5, 0.6],
        filename: `CloudPilot-Report-${ts}-${message?.id?.slice(0, 8)}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          onclone: (document: Document) => {
            document.documentElement.classList.remove("dark");
          },
        },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      } as any;
      await html2pdf().set(opt).from(reportContentRef.current).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [message, downloading]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-foreground font-medium">{error}</p>
          <Link to="/app" className="text-sm text-primary underline underline-offset-2">
            Back to CloudPilot AI
          </Link>
        </div>
      </div>
    );
  }

  const timestamp = message ? new Date(message.created_at) : null;
  const healthScore = auditCache ? calculateHealthScore(auditCache.totals.severityCounts) : 100;
  
  // Prepare Recharts Donut data
  const pieData = auditCache
    ? Object.entries(auditCache.totals.severityCounts)
        .filter(([_, count]) => count > 0 && _ !== "INFO")
        .map(([severity, count]) => ({
          name: severity,
          value: count,
          color: SEVERITY_COLORS[severity] || "#6b7280"
        }))
    : [];

  // Prepare Recharts Service Bar data
  const serviceCounts: Record<string, number> = {};
  if (auditCache?.findingsForPanel) {
    auditCache.findingsForPanel.forEach((f) => {
      const srv = f.id.split("-")[0]?.toUpperCase() || "AWS";
      serviceCounts[srv] = (serviceCounts[srv] || 0) + 1;
    });
  }
  const barData = Object.entries(serviceCounts).map(([service, count]) => ({
    name: service,
    count,
  }));

  const scoreColorClass = healthScore >= 85
    ? "text-emerald-400"
    : healthScore >= 65
    ? "text-warning"
    : "text-destructive";

  return (
    <div className="min-h-screen bg-background">
      {/* Header bar */}
      <header className="print:hidden sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/app"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Chat
          </Link>
          <span className="text-border">|</span>
          <div className="flex items-center gap-2">
            <CloudPilotLogo className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">CloudPilot AI</span>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              Security Operations Plane
            </span>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center bg-muted/65 p-1 rounded-lg border border-border">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "dashboard"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Gauge className="w-3.5 h-3.5 text-primary" />
            Interactive Dashboard
          </button>
          <button
            onClick={() => setActiveTab("report")}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "report"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-primary" />
            AI Text Report
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={downloadPdf}
            disabled={downloading}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {downloading ? "Generating..." : "Download PDF"}
          </button>
          <span className="text-border">|</span>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </header>

      {/* Main Report Dashboard */}
      {activeTab === "dashboard" && auditCache ? (
        <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
          
          {/* Header Row */}
          <div className="flex items-start justify-between border-b border-border pb-5">
            <div>
              <p className="text-xs font-mono text-primary tracking-widest uppercase">INTERACTIVE SECURITY WORKSPACE</p>
              <h1 className="text-2xl font-bold text-foreground mt-1">{conversation?.title || "Security Audit Findings"}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Visualizing findings, risks, remediation steps, and scoring models for your AWS account.
              </p>
            </div>
            {timestamp && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono bg-card border border-border px-3 py-1.5 rounded-lg">
                <Clock className="w-3.5 h-3.5 text-primary" />
                {timestamp.toLocaleString()}
              </div>
            )}
          </div>

          {/* Top Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {/* Health Score Gauge */}
            <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between md:col-span-2">
              <div className="space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  Account Security Score
                </p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-4xl font-extrabold tracking-tight ${scoreColorClass}`}>
                    {healthScore}
                  </span>
                  <span className="text-muted-foreground text-sm">/ 100</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Score is calculated by applying severity-weighted penalty deductions to a base of 100.
                </p>
              </div>

              {/* Glowing dial */}
              <div className="relative w-24 h-24 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r="38"
                    className="stroke-muted fill-none"
                    strokeWidth="8"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="38"
                    className="fill-none transition-all duration-1000"
                    stroke={healthScore >= 85 ? "#10b981" : healthScore >= 65 ? "#eab308" : "#ef4444"}
                    strokeWidth="8"
                    strokeDasharray={238}
                    strokeDashoffset={238 - (238 * healthScore) / 100}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-lg font-bold">{healthScore}%</span>
                  <span className="text-[8px] font-mono text-muted-foreground uppercase">HEALTH</span>
                </div>
              </div>
            </div>

            {/* Severity Breakdown */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">SEVERITY MATRICES</p>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-destructive/5 rounded-lg border border-destructive/10 p-2">
                  <span className="text-[10px] font-mono text-destructive uppercase block">Critical</span>
                  <span className="text-lg font-bold text-destructive">{auditCache.totals.severityCounts.CRITICAL || 0}</span>
                </div>
                <div className="bg-orange-500/5 rounded-lg border border-orange-500/10 p-2">
                  <span className="text-[10px] font-mono text-orange-400 uppercase block">High</span>
                  <span className="text-lg font-bold text-orange-400">{auditCache.totals.severityCounts.HIGH || 0}</span>
                </div>
                <div className="bg-warning/5 rounded-lg border border-warning/10 p-2">
                  <span className="text-[10px] font-mono text-warning uppercase block">Medium</span>
                  <span className="text-lg font-bold text-warning">{auditCache.totals.severityCounts.MEDIUM || 0}</span>
                </div>
                <div className="bg-blue-500/5 rounded-lg border border-blue-500/10 p-2">
                  <span className="text-[10px] font-mono text-blue-400 uppercase block">Low</span>
                  <span className="text-lg font-bold text-blue-400">{auditCache.totals.severityCounts.LOW || 0}</span>
                </div>
              </div>
            </div>

            {/* Assess totals */}
            <div className="rounded-xl border border-border bg-card p-5 flex flex-col justify-between">
              <div className="space-y-1">
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">AUDIT SCOPE</p>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">Evaluated</span>
                    <p className="text-xl font-bold">{auditCache.totals.resourcesEvaluated || 44} resources</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">Assessed</span>
                    <p className="text-xl font-bold">{auditCache.totals.servicesAssessed || 5} services</p>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t border-border/50 text-[10px] font-mono text-muted-foreground">
                OVERALL RISK LEVEL: <span className="font-bold text-primary">{auditCache.totals.overallRisk}</span>
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Donut Chart */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Findings Severity Distribution</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Deduplicated severity counts of active exposures.</p>
              </div>
              <div className="h-64 flex items-center justify-center">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155" }}
                        itemStyle={{ color: "#f8fafc" }}
                      />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center space-y-2">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="text-xs text-muted-foreground">No critical, high, medium, or low security findings detected!</p>
                  </div>
                )}
              </div>
            </div>

            {/* Service Bar Chart */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Findings by AWS Service</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Exposures sorted by primary AWS service components.</p>
              </div>
              <div className="h-64 flex items-center justify-center">
                {barData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <XAxis type="number" stroke="#64748b" fontSize={10} />
                      <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={10} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", borderColor: "#334155" }}
                        itemStyle={{ color: "#f8fafc" }}
                      />
                      <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                        {barData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill="#3b82f6" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center space-y-2">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="text-xs text-muted-foreground">All assessed services conform fully to standard baselines.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Findings & Remediation Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left side: Accordions (takes 2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">Exposures & Remediation Steps</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Select a finding to expand its risk explanation, framework alignments, and fix scripts.
                </p>
              </div>

              <div className="space-y-2">
                {auditCache.findingsForPanel && auditCache.findingsForPanel.length > 0 ? (
                  auditCache.findingsForPanel.map((f) => {
                    const isExpanded = expandedFindings[f.id] ?? false;
                    const frameworks = getFrameworks(f.id, f.title);
                    
                    return (
                      <div key={f.id} className="rounded-xl border border-border bg-card/60 overflow-hidden transition-all duration-200">
                        <button
                          type="button"
                          onClick={() => toggleFinding(f.id)}
                          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors focus:outline-none"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: SEVERITY_COLORS[f.severity] }} />
                            <div>
                              <p className="text-sm font-semibold text-foreground">{f.title}</p>
                              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">Resource: {f.resource}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono font-semibold px-2 py-0.5 rounded border" style={{ color: SEVERITY_COLORS[f.severity], borderColor: `${SEVERITY_COLORS[f.severity]}25`, backgroundColor: `${SEVERITY_COLORS[f.severity]}08` }}>
                              {f.severity}
                            </span>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/60" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/60" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-4 pt-0 border-t border-border/10 space-y-4 bg-muted/5 animate-fade-in">
                            {/* Framework Badges */}
                            <div className="space-y-1.5 pt-3">
                              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Framework Compliance Mapping</p>
                              <div className="flex flex-wrap gap-1.5">
                                {frameworks.map((fw) => (
                                  <span key={fw.name + fw.control} className="flex items-center gap-1 bg-primary/8 text-primary border border-primary/15 text-[10px] px-2 py-0.5 rounded font-medium">
                                    <Shield className="w-3 h-3" />
                                    <span className="font-bold">{fw.name}:</span>
                                    <span>{fw.control}</span>
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Risk Explanation */}
                            <div className="space-y-1.5">
                              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                                Security Risk / Impact
                              </p>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {f.description || "Exposure allows unauthorized administrative execution or public data leak due to overly broad wildcard configurations."}
                              </p>
                            </div>

                            {/* Remediation steps */}
                            {f.remediation && (
                              <div className="space-y-1.5">
                                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                                  Remediation CLI Command
                                </p>
                                <div className="relative">
                                  <pre className="bg-muted border border-border rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto pr-10 leading-normal">
                                    <code>{f.remediation}</code>
                                  </pre>
                                  <button
                                    onClick={() => copyToClipboard(f.remediation || "")}
                                    className="absolute top-2 right-2 p-1.5 rounded border border-border bg-card/85 text-muted-foreground hover:text-foreground transition-all hover:bg-muted/80"
                                    title="Copy AWS CLI command"
                                  >
                                    {copiedCommand === f.remediation ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-border border-dashed p-10 text-center space-y-3">
                    <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto" />
                    <h3 className="text-sm font-semibold">No Security Findings Detected</h3>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      All scanned resources conform fully to CIS Benchmarks and standard AWS security profiles.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right side: Scoring & Methodology (takes 1 col) */}
            <div className="space-y-6">
              {/* Scoring Methodology */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Scoring Methodology</h3>
                </div>
                <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
                  <p>
                    CloudPilot AI evaluates your account's health score using a **Weighted Deduction Model**. Starting at **100 points**, deductions are applied dynamically based on the severity of active exposures:
                  </p>
                  <ul className="space-y-2 border-l border-border pl-3 mt-2">
                    <li>
                      <span className="font-bold text-destructive">Critical Findings:</span>
                      <p className="text-[11px]">-20 points each (capped at a max deduction of 60 points).</p>
                    </li>
                    <li>
                      <span className="font-bold text-orange-400">High Findings:</span>
                      <p className="text-[11px]">-8 points each (capped at a max deduction of 45 points).</p>
                    </li>
                    <li>
                      <span className="font-bold text-warning">Medium Findings:</span>
                      <p className="text-[11px]">-3 points each (capped at a max deduction of 30 points).</p>
                    </li>
                    <li>
                      <span className="font-bold text-blue-400">Low Findings:</span>
                      <p className="text-[11px]">-1 point each (capped at a max deduction of 15 points).</p>
                    </li>
                  </ul>
                  <div className="bg-muted/40 p-2.5 rounded border border-border font-mono text-[10px] text-foreground">
                    <p className="font-bold uppercase tracking-wider text-[8px] text-muted-foreground">Score Equation</p>
                    <p className="mt-1">Score = Max(0, 100 - Σ Deductions)</p>
                  </div>
                </div>
              </div>

              {/* Risk Severities Mapping */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Risk Severity Standards</h3>
                </div>
                <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
                  <p>
                    Severities are mapped to risk classes following the **Common Vulnerability Scoring System (CVSS v3.1)** standards:
                  </p>
                  <ul className="space-y-1.5 list-disc list-inside">
                    <li><span className="font-semibold text-destructive">Critical (CVSS 9.0–10.0):</span> Public access leaks, unauthenticated RCE, administrative credentials exposed in logs.</li>
                    <li><span className="font-semibold text-orange-400">High (CVSS 7.0–8.9):</span> Ingress ports SSH/RDP wide open, MFA disabled on privileged users, unencrypted database storage.</li>
                    <li><span className="font-semibold text-warning">Medium (CVSS 4.0–6.9):</span> Missing S3 Object Lock, unencrypted EBS storage, overly permissive IAM roles.</li>
                    <li><span className="font-semibold text-blue-400">Low (CVSS 0.1–3.9):</span> S3 versioning disabled, lacking CloudWatch alarm thresholds.</li>
                  </ul>
                </div>
              </div>
            </div>

          </div>
        </main>
      ) : (
        /* Original AI markdown text report view */
        <main className="max-w-4xl mx-auto px-6 py-10" ref={reportContentRef}>
          <div className="mb-8 pb-6 border-b border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center print:hidden">
                <CloudPilotLogo className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {conversation?.title ?? "Security Report"}
                </h1>
                <p className="text-xs text-muted-foreground">CloudPilot AI — AWS Cloud Security Intelligence</p>
              </div>
            </div>
            {timestamp && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                <Clock className="w-3.5 h-3.5" />
                {timestamp.toLocaleString([], {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
          </div>

          {message && (
            <div className={`
              prose max-w-none
              [&_p]:text-[14px] [&_p]:leading-[1.8] [&_p]:text-foreground [&_p]:my-3
              [&_ul]:my-3 [&_ul]:pl-5 [&_ul]:space-y-1.5
              [&_ol]:my-3 [&_ol]:pl-5 [&_ol]:space-y-1.5
              [&_li]:text-[14px] [&_li]:leading-[1.75] [&_li]:text-foreground
              [&_strong]:font-bold [&_strong]:text-foreground
              [&_h1]:text-foreground [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:pb-3 [&_h1]:border-b [&_h1]:border-border
              [&_h2]:text-foreground [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3
              [&_h3]:text-primary [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:uppercase [&_h3]:tracking-wide
              [&_code]:font-mono [&_code]:bg-muted [&_code]:border [&_code]:border-border [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-primary [&_code]:text-[12px]
              [&_pre]:bg-muted/60 [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:my-4
              [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:border-0 [&_pre_code]:text-foreground
              [&_table]:w-full [&_table]:text-[13px] [&_table]:border-collapse [&_table]:my-4
              [&_thead]:bg-muted
              [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:text-muted-foreground [&_th]:uppercase [&_th]:tracking-wider [&_th]:border [&_th]:border-border
              [&_td]:px-4 [&_td]:py-2.5 [&_td]:border [&_td]:border-border [&_td]:text-[13px] [&_td]:text-foreground
              [&_tr:nth-child(even)_td]:bg-muted/30
              [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary/50 [&_blockquote]:pl-4 [&_blockquote]:my-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic
              [&_hr]:border-border [&_hr]:my-6
            `}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}

          <div className="mt-12 pt-6 border-t border-border flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>Generated by CloudPilot AI</span>
            {timestamp && (
              <span>{timestamp.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}</span>
            )}
          </div>
        </main>
      )}

      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default Report;
