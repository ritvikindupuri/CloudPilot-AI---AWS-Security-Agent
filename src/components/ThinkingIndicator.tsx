import { useState, useEffect } from "react";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { Shield, Cpu, Play, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";

interface LogItem {
  step: string;
  status: "info" | "success" | "warning" | "error";
  message: string;
}

interface ThinkingIndicatorProps {
  logs?: LogItem[];
}

const ThinkingIndicator = ({ logs = [] }: ThinkingIndicatorProps) => {
  const [visibleLogs, setVisibleLogs] = useState<LogItem[]>([]);

  useEffect(() => {
    if (logs.length === 0) {
      setVisibleLogs([]);
      return;
    }

    // Sequentially animate the appearance of each log item to make it feel live
    const timerIds: number[] = [];
    logs.forEach((log, index) => {
      const id = setTimeout(() => {
        setVisibleLogs((prev) => {
          // Avoid duplicate logs if state updates multiple times
          if (prev.some((p) => p.message === log.message && p.step === log.step)) {
            return prev;
          }
          return [...prev, log];
        });
      }, index * 800); // 800ms stagger delay
      timerIds.push(id);
    });

    return () => {
      timerIds.forEach((id) => clearTimeout(id));
    };
  }, [logs]);

  const getIcon = (status: string, step: string) => {
    if (status === "success") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />;
    if (status === "warning") return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />;
    if (status === "error") return <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />;
    
    // Fallback based on step
    if (step === "Router") return <Cpu className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5 animate-pulse" />;
    if (step === "Safety Gate") return <Shield className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />;
    if (step === "Execution") return <Play className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5 animate-pulse" />;
    return <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />;
  };

  return (
    <div className="animate-fade-in-up flex gap-3 px-5 py-3">
      <div className="flex-shrink-0 mt-1">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
          <CloudPilotLogo className="w-5 h-5 text-primary animate-pulse" />
        </div>
      </div>
      <div className="rounded-xl px-5 py-4 bg-card border border-border/60 flex flex-col gap-3 min-w-[280px] max-w-lg shadow-lg shadow-black/20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[11px] font-mono text-muted-foreground tracking-wide">Agent is thinking...</span>
        </div>

        {visibleLogs.length > 0 && (
          <div className="border-t border-border/30 pt-3 flex flex-col gap-2">
            {visibleLogs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-[10px] font-mono leading-relaxed animate-fade-in-up">
                {getIcon(log.status, log.step)}
                <div className="flex flex-col">
                  <span className="text-[#86868b] text-[9px] uppercase tracking-wider font-semibold">{log.step}</span>
                  <span className="text-foreground/90">{log.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ThinkingIndicator;
