import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  Search,
  FileText,
  Calendar,
  AlertTriangle,
  Clock,
  ExternalLink,
  Download,
  Loader2,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface ReportEntry {
  id: string;
  content: string;
  created_at: string;
  conversation_id: string;
  conversation_title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" | "UNKNOWN";
}

function extractSeverity(content: string): ReportEntry["severity"] {
  // Look for Overall Risk Rating in content
  const ratingMatch = content.match(/Overall Risk Rating[:\s]*\*?\*?(CRITICAL|HIGH|MEDIUM|LOW|INFO)\*?\*?/i);
  if (ratingMatch) return ratingMatch[1].toUpperCase() as ReportEntry["severity"];

  // Fallback: check for severity emoji patterns
  if (content.includes("🔴 CRITICAL")) return "CRITICAL";
  if (content.includes("🟠 HIGH")) return "HIGH";
  if (content.includes("🟡 MEDIUM")) return "MEDIUM";
  if (content.includes("🔵 LOW")) return "LOW";
  return "UNKNOWN";
}

const severityColor: Record<string, string> = {
  CRITICAL: "bg-red-500/15 text-red-400 border-red-500/30",
  HIGH: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  MEDIUM: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  LOW: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  INFO: "bg-muted text-muted-foreground border-border",
  UNKNOWN: "bg-muted text-muted-foreground border-border",
};

const ReportsHistory = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");

  useEffect(() => {
    if (authLoading || !user) return;

    const loadReports = async () => {
      setLoading(true);

      // Get all assistant messages (reports) for this user's conversations
      const { data: conversations } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("conversations" as any)
        .select("id, title")
        .eq("user_id", user.id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .order("updated_at", { ascending: false }) as any);

      if (!conversations || conversations.length === 0) {
        setReports([]);
        setLoading(false);
        return;
      }

      const convMap = new Map<string, string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conversations.forEach((c: any) => convMap.set(c.id, c.title));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const convIds = conversations.map((c: any) => c.id);

      const { data: messages } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("messages" as any)
        .select("id, content, created_at, conversation_id")
        .eq("role", "assistant")
        .in("conversation_id", convIds)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .order("created_at", { ascending: false }) as any);

      if (!messages) {
        setReports([]);
        setLoading(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries: ReportEntry[] = (messages as any[]).map((m) => ({
        id: m.id,
        content: m.content,
        created_at: m.created_at,
        conversation_id: m.conversation_id,
        conversation_title: convMap.get(m.conversation_id) || "Untitled",
        severity: extractSeverity(m.content),
      }));

      setReports(entries);
      setLoading(false);
    };

    loadReports();
  }, [user, authLoading]);

  const filtered = useMemo(() => {
    let result = reports;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          r.conversation_title.toLowerCase().includes(q)
      );
    }

    if (severityFilter !== "all") {
      result = result.filter((r) => r.severity === severityFilter);
    }

    if (dateFilter !== "all") {
      const now = new Date();
      const cutoff = new Date();
      if (dateFilter === "today") cutoff.setHours(0, 0, 0, 0);
      else if (dateFilter === "week") cutoff.setDate(now.getDate() - 7);
      else if (dateFilter === "month") cutoff.setMonth(now.getMonth() - 1);
      result = result.filter((r) => new Date(r.created_at) >= cutoff);
    }

    return result;
  }, [reports, searchQuery, severityFilter, dateFilter]);

  // Extract first meaningful line as title
  const getReportTitle = (content: string): string => {
    const lines = content.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      const cleaned = line.replace(/^#+\s*/, "").replace(/[🛡📦⚠🔴🟠🟡🔵⚪]/gu, "").trim();
      if (cleaned.length > 5 && cleaned.length < 120) return cleaned;
    }
    return "Security Assessment Report";
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between">
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
            <span className="text-sm font-semibold text-foreground">Reports History</span>
            <Badge variant="outline" className="text-[10px] font-mono">
              {filtered.length} reports
            </Badge>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-5xl mx-auto px-6 py-5">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search reports by content or title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-muted border-border"
            />
          </div>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-full sm:w-[160px] bg-muted border-border">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
                <SelectValue placeholder="Severity" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-full sm:w-[140px] bg-muted border-border">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <SelectValue placeholder="Date" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Past 7 Days</SelectItem>
              <SelectItem value="month">Past 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Reports List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground font-mono">Loading reports...</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-foreground font-medium mb-1">No reports found</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {reports.length === 0
                ? "Start a security analysis to generate your first report."
                : "Try adjusting your search or filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((report) => {
              const ts = new Date(report.created_at);
              const title = getReportTitle(report.content);

              return (
                <div
                  key={report.id}
                  className="group border border-border rounded-lg bg-card hover:border-primary/30 transition-all cursor-pointer"
                  onClick={() => navigate(`/report/${report.id}`)}
                >
                  <div className="flex items-start gap-4 p-4">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{title}</p>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {report.conversation_title}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-mono ${severityColor[report.severity]}`}
                          >
                            {report.severity}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                          <Clock className="w-3 h-3" />
                          {format(ts, "MMM d, yyyy 'at' HH:mm")}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ExternalLink className="w-3 h-3" />
                          View full report
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsHistory;
