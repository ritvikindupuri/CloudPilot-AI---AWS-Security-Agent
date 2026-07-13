import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Loader2, CheckCircle, AlertOctagon, ExternalLink, Copy, Check, Download, CloudUpload, Trash2 } from "lucide-react";
import CloudPilotLogo from "@/components/CloudPilotLogo";

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "streaming" | "complete" | "error";

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  timestamp: Date;
}

interface ChatMessageProps {
  message: ChatMessageData;
  onAddToS3?: (content: string, messageId: string) => Promise<void>;
  onTeardownVpc?: () => void;
}

const ChatMessage = ({ message, onAddToS3, onTeardownVpc }: ChatMessageProps) => {
  const isUser = message.role === "user";
  const isComplete = message.status === "complete" && !isUser;
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const reportUrl = `${window.location.origin}/report/${message.id}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(reportUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadPdf = useCallback(async () => {
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const timestamp = message.timestamp.toISOString().slice(0, 10);
      const opt = {
        margin: [0.5, 0.6, 0.5, 0.6],
        filename: `CloudPilot-Report-${timestamp}-${message.id.slice(0, 8)}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          onclone: (clonedDoc: Document) => {
            clonedDoc.documentElement.classList.remove("dark");
            
            const clonedContent = clonedDoc.getElementById(`msg-content-${message.id}`);
            if (clonedContent) {
              const style = clonedDoc.createElement("style");
              style.innerHTML = `
                .pdf-print-container {
                  background-color: #ffffff !important;
                  color: #0f172a !important;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                  padding: 0.4in !important;
                }
                .pdf-print-container h1, 
                .pdf-print-container h2, 
                .pdf-print-container h3, 
                .pdf-print-container h4, 
                .pdf-print-container p, 
                .pdf-print-container li,
                .pdf-print-container td,
                .pdf-print-container th,
                .pdf-print-container strong {
                  color: #0f172a !important;
                }
                
                .pdf-cover-page {
                  height: 9.5in;
                  display: flex;
                  flex-direction: column;
                  justify-content: space-between;
                  padding: 1in 0.5in;
                  border-top: 10px solid #1e3a8a;
                  page-break-after: always;
                }
                .pdf-cover-title-box {
                  margin-top: 1.5in;
                }
                .pdf-cover-logo {
                  font-size: 14px;
                  font-weight: 800;
                  letter-spacing: 0.1em;
                  color: #1e3a8a !important;
                  text-transform: uppercase;
                  margin-bottom: 20px;
                }
                .pdf-cover-title {
                  font-size: 32px;
                  font-weight: 800;
                  line-height: 1.2;
                  color: #0f172a !important;
                  margin-bottom: 15px;
                }
                .pdf-cover-subtitle {
                  font-size: 16px;
                  color: #475569 !important;
                  font-weight: 400;
                }
                .pdf-cover-meta-box {
                  margin-bottom: 1in;
                  background-color: #f8fafc;
                  border: 1px solid #e2e8f0;
                  border-radius: 8px;
                  padding: 20px;
                }
                .pdf-cover-meta-grid {
                  display: grid;
                  grid-template-columns: 1.5in 1fr;
                  row-gap: 8px;
                  font-size: 12px;
                }
                .pdf-cover-meta-label {
                  font-weight: 600;
                  color: #64748b !important;
                }
                .pdf-cover-meta-value {
                  color: #334155 !important;
                }
                
                .pdf-print-container h2 {
                  font-size: 18px !important;
                  font-weight: 700 !important;
                  border-bottom: 1.5px solid #cbd5e1 !important;
                  padding-bottom: 6px !important;
                  margin-top: 30px !important;
                  margin-bottom: 15px !important;
                  page-break-inside: avoid;
                }
                .pdf-print-container h3 {
                  font-size: 14px !important;
                  font-weight: 700 !important;
                  color: #1e3a8a !important;
                  margin-top: 20px !important;
                  margin-bottom: 10px !important;
                  page-break-inside: avoid;
                }
                .pdf-print-container p, 
                .pdf-print-container li {
                  font-size: 12px !important;
                  line-height: 1.6 !important;
                }
                .pdf-print-container pre {
                  background-color: #f8fafc !important;
                  border: 1px solid #e2e8f0 !important;
                  color: #0f172a !important;
                  border-radius: 6px !important;
                  padding: 12px !important;
                  font-size: 10px !important;
                  page-break-inside: avoid;
                  white-space: pre-wrap !important;
                  word-break: break-all !important;
                }
                .pdf-print-container code {
                  background-color: #f1f5f9 !important;
                  color: #b91c1c !important;
                  padding: 2px 4px !important;
                  border-radius: 4px !important;
                  font-size: 10.5px !important;
                }
                .pdf-print-container table {
                  width: 100% !important;
                  border-collapse: collapse !important;
                  margin: 15px 0 !important;
                  page-break-inside: avoid;
                }
                .pdf-print-container th {
                  background-color: #f1f5f9 !important;
                  color: #1e293b !important;
                  font-weight: 600 !important;
                  font-size: 11px !important;
                  border: 1px solid #cbd5e1 !important;
                  padding: 8px 10px !important;
                }
                .pdf-print-container td {
                  border: 1px solid #cbd5e1 !important;
                  padding: 8px 10px !important;
                  font-size: 11px !important;
                }
                .pdf-print-container tr:nth-child(even) td {
                  background-color: #f8fafc !important;
                }
              `;
              clonedDoc.head.appendChild(style);
              
              clonedContent.className = "prose max-w-none pdf-print-container";
              
              const coverPage = clonedDoc.createElement("div");
              coverPage.className = "pdf-cover-page";
              
              const titleBox = clonedDoc.createElement("div");
              titleBox.className = "pdf-cover-title-box";
              
              const logo = clonedDoc.createElement("div");
              logo.className = "pdf-cover-logo";
              logo.textContent = "CLOUDPILOT AI";
              
              const title = clonedDoc.createElement("h1");
              title.className = "pdf-cover-title";
              title.textContent = "SECURITY ASSESSMENT REPORT";
              
              const subtitle = clonedDoc.createElement("div");
              subtitle.className = "pdf-cover-subtitle";
              subtitle.textContent = "Comprehensive AWS Infrastructure Audit & Strategic Security Runbook";
              
              titleBox.appendChild(logo);
              titleBox.appendChild(title);
              titleBox.appendChild(subtitle);
              
              const metaBox = clonedDoc.createElement("div");
              metaBox.className = "pdf-cover-meta-box";
              
              const metaGrid = clonedDoc.createElement("div");
              metaGrid.className = "pdf-cover-meta-grid";
              
              const addMetaRow = (label: string, value: string) => {
                const labelDiv = clonedDoc.createElement("div");
                labelDiv.className = "pdf-cover-meta-label";
                labelDiv.textContent = label;
                
                const valueDiv = clonedDoc.createElement("div");
                valueDiv.className = "pdf-cover-meta-value";
                valueDiv.textContent = value;
                
                metaGrid.appendChild(labelDiv);
                metaGrid.appendChild(valueDiv);
              };
              
              const now = new Date();
              const dateStr = now.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZoneName: "short"
              });
              
              addMetaRow("Report ID:", `CPR-${timestamp}-${message.id.slice(0, 8).toUpperCase()}`);
              addMetaRow("Date Generated:", dateStr);
              addMetaRow("Classification:", "CONFIDENTIAL — AUTHORIZED USE ONLY");
              addMetaRow("Distribution:", "Internal Security Teams — Need-to-Know Basis");
              addMetaRow("Assessment Engine:", "CloudPilot AI Agent v1.0");
              
              metaBox.appendChild(metaGrid);
              
              coverPage.appendChild(titleBox);
              coverPage.appendChild(metaBox);
              
              clonedContent.insertBefore(coverPage, clonedContent.firstChild);
            }
          },
        },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      } as any;
      await html2pdf().set(opt).from(contentRef.current).save();
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [message, downloading]);

  const handleAddToS3 = useCallback(async () => {
    if (!onAddToS3 || uploading || uploaded) return;
    setUploading(true);
    try {
      await onAddToS3(message.content, message.id);
      setUploaded(true);
      setTimeout(() => setUploaded(false), 5000);
    } catch (err) {
      console.error("S3 upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, [onAddToS3, message, uploading, uploaded]);

  return (
    <div className={`animate-fade-in-up flex gap-3 px-5 py-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
            <CloudPilotLogo className="w-5 h-5 text-primary" />
          </div>
        </div>
      )}

      <div className={`rounded-xl px-5 py-4 text-sm leading-relaxed ${
        isUser
          ? "max-w-[72%] bg-secondary border border-border"
          : "flex-1 min-w-0 bg-card border border-border/60"
      }`}>
        {isUser ? (
          <p className="text-foreground text-[13px] leading-6">{message.content}</p>
        ) : (
          <div
            ref={contentRef}
            id={`msg-content-${message.id}`}
            className="
            prose max-w-none

            [&_p]:text-[13px] [&_p]:leading-[1.75] [&_p]:text-foreground [&_p]:my-2.5

            [&_ul]:my-2.5 [&_ul]:pl-5 [&_ul]:space-y-1
            [&_ol]:my-2.5 [&_ol]:pl-5 [&_ol]:space-y-1
            [&_li]:text-[13px] [&_li]:leading-[1.7] [&_li]:text-foreground

            [&_strong]:font-bold [&_strong]:text-foreground

            [&_h1]:text-foreground [&_h1]:text-[17px] [&_h1]:font-bold [&_h1]:mt-5 [&_h1]:mb-3 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-border
            [&_h2]:text-foreground [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2.5
            [&_h3]:text-primary [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:uppercase [&_h3]:tracking-wide

            [&_code]:font-mono [&_code]:bg-muted [&_code]:border [&_code]:border-border [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-primary [&_code]:text-[11.5px]
            [&_pre]:bg-muted/60 [&_pre]:border [&_pre]:border-border [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-[11.5px] [&_pre]:overflow-x-auto [&_pre]:my-3
            [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:border-0 [&_pre_code]:text-foreground [&_pre_code]:text-[11.5px]

            [&_table]:w-full [&_table]:text-[12px] [&_table]:border-collapse [&_table]:my-3 [&_table]:rounded-lg [&_table]:overflow-hidden
            [&_thead]:bg-muted
            [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:text-muted-foreground [&_th]:uppercase [&_th]:tracking-wider [&_th]:border [&_th]:border-border
            [&_td]:px-3.5 [&_td]:py-2 [&_td]:border [&_td]:border-border [&_td]:text-[12px] [&_td]:text-foreground
            [&_tr:nth-child(even)_td]:bg-muted/30

            [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary/50 [&_blockquote]:pl-4 [&_blockquote]:my-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic

            [&_hr]:border-border [&_hr]:my-4

            [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}

        {/* Status row */}
        <div className="flex items-center justify-between mt-2.5 gap-2">
          <div className="flex items-center gap-1.5">
            {message.status === "streaming" && (
              <div className="flex items-center gap-1.5 text-terminal-dim">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-[10px] font-mono tracking-wider uppercase">Executing AWS queries...</span>
              </div>
            )}
            {isComplete && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle className="w-3 h-3 text-primary/60" />
                <span className="text-[10px] font-mono">
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            )}
            {message.status === "error" && (() => {
              let errorText = "Error — check credentials and try again";
              if (message.content.includes("Rate limit")) {
                errorText = "Error — rate limit exceeded";
              } else if (message.content.includes("AI usage credits exhausted")) {
                errorText = "Error — AI usage credits exhausted";
              }
              return (
                <div className="flex items-center gap-1.5 text-destructive">
                  <AlertOctagon className="w-3 h-3" />
                  <span className="text-[10px] font-mono">{errorText}</span>
                </div>
              );
            })()}
          </div>

          {/* Report actions — only on completed assistant messages */}
          {isComplete && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={downloadPdf}
                disabled={downloading}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors px-1.5 py-1 rounded hover:bg-primary/8 disabled:opacity-40"
                title="Download as PDF"
              >
                {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                {downloading ? "Generating..." : "Download PDF"}
              </button>
              <button
                onClick={handleAddToS3}
                disabled={uploading || uploaded}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors px-1.5 py-1 rounded hover:bg-primary/8 disabled:opacity-40"
                title="Archive report to S3 bucket"
              >
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CloudUpload className="w-3 h-3" />}
                {uploading ? "Uploading..." : uploaded ? "✓ Added to S3" : "Add to S3"}
              </button>
              <button
                onClick={() => navigate(`/report/${message.id}`)}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors px-1.5 py-1 rounded hover:bg-primary/8"
                title="View full report"
              >
                <ExternalLink className="w-3 h-3" />
                View Report
              </button>
              <button
                onClick={copyLink}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors px-1.5 py-1 rounded hover:bg-primary/8"
                title="Copy report link"
              >
                {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy Link"}
              </button>
              {onTeardownVpc && (
                <button
                  onClick={onTeardownVpc}
                  className="flex items-center gap-1 text-[10px] font-mono text-destructive/70 hover:text-destructive transition-colors px-1.5 py-1 rounded hover:bg-destructive/10 border border-transparent hover:border-destructive/30"
                  title="Tear down all VPC resources the agent created"
                >
                  <Trash2 className="w-3 h-3" />
                  Teardown VPC
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-lg bg-secondary border border-border flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
