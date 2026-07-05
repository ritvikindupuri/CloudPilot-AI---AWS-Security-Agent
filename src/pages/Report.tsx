import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Printer, Clock, AlertCircle, Loader2, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { useAuth } from "@/hooks/useAuth";

interface ReportMessage {
  id: string;
  content: string;
  created_at: string;
  conversation_id: string;
}

interface ReportConversation {
  title: string;
}

const Report = () => {
  const { messageId } = useParams<{ messageId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [message, setMessage] = useState<ReportMessage | null>(null);
  const [conversation, setConversation] = useState<ReportConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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

    const load = async () => {
      const { data: msg, error: msgErr } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("messages" as any)
        .select("id, content, created_at, conversation_id")
        .eq("id", messageId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .single() as any);

      if (msgErr || !msg) {
        setError("Report not found or you don't have access to it.");
        setLoading(false);
        return;
      }

      setMessage(msg as ReportMessage);

      const { data: conv } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("conversations" as any)
        .select("title")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq("id", (msg as any).conversation_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .single() as any);

      if (conv) setConversation(conv as ReportConversation);
      setLoading(false);
    };

    load();
  }, [messageId, user, authLoading, navigate]);

  const downloadPdf = useCallback(async () => {
    if (!reportContentRef.current || downloading) return;
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const ts = message ? new Date(message.created_at).toISOString().slice(0, 10) : "report";
      const opt = {
        margin: [0.5, 0.6, 0.5, 0.6],
        filename: `CloudPilot-Report-${ts}-${messageId?.slice(0, 8)}.pdf`,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      await html2pdf().set(opt).from(reportContentRef.current).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [message, messageId, downloading]);

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

  return (
    <div className="min-h-screen bg-background">
      {/* Print-hidden header */}
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
              Security Report
            </span>
          </div>
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

      {/* Report content */}
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
