import { useState, useCallback, useEffect, useRef } from "react";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/integrations/supabase/client";
import type { ChatMessageData, MessageRole, MessageStatus } from "@/components/ChatMessage";
import type { AwsCredentials } from "@/components/AwsCredentialsPanel";
import type { Finding } from "@/components/FindingsPanel";

interface AuditSummary {
  planner: {
    intent: string;
    scanners: string[];
  };
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
  cache: {
    status: "fresh" | "cached";
    lastRefreshedAt: string;
    ttlSeconds: number;
  };
  accountHealthScore: number;
  findingsForPanel: Array<{
    id: string;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    resource: string;
    timestamp: string;
    fixPrompt?: string;
  }>;
  servicesAssessed: string[];
}

interface LiveRunbookStep {
  id: string;
  stepId: string;
  stepName: string;
  status: string;
  risk: string;
  output: string | null;
  stepOrder: number;
  updatedAt: string;
}

interface LiveRunbookExecution {
  id: string;
  runbookId: string;
  runbookName: string;
  status: string;
  dryRun: boolean;
  currentStepIndex: number;
  lastError: string | null;
  updatedAt: string;
  steps: LiveRunbookStep[];
}

export const useChat = (
  conversationId: string | null,
  credentials: AwsCredentials | null,
  notificationEmail?: string,
  createConversation?: (title: string) => Promise<any>,
  onConversationCreated?: (id: string) => void
) => {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [liveRunbook, setLiveRunbook] = useState<LiveRunbookExecution | null>(null);
  const [executionLogs, setExecutionLogs] = useState<any[]>([]);

  const currentMessagesConvIdRef = useRef<string | null>(conversationId);
  const justCreatedConvRef = useRef<string | null>(null);

  // Load the active unified audit cache if it exists for the current AWS account
  useEffect(() => {
    if (!credentials) {
      setAuditSummary(null);
      return;
    }

    const fetchLatestAudit = async () => {
      try {
        let dbQuery = supabase.from("unified_audit_cache" as any).select("*");
        if (credentials.identity?.account) {
          dbQuery = dbQuery.eq("account_id", credentials.identity.account);
        }

        const { data, error } = await dbQuery
          .order("last_refreshed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.warn("[useChat] Failed to load cached audit:", error);
          return;
        }

        if (data && data.response) {
          const cachedData = data.response;
          
          const score = Math.max(0,
            100 -
            Math.min(60, (cachedData.totals.severityCounts.CRITICAL || 0) * 20) -
            Math.min(45, (cachedData.totals.severityCounts.HIGH || 0) * 8) -
            Math.min(30, (cachedData.totals.severityCounts.MEDIUM || 0) * 3) -
            Math.min(15, (cachedData.totals.severityCounts.LOW || 0) * 1)
          );

          setAuditSummary({
            planner: data.planner,
            totals: cachedData.totals,
            cache: {
              status: "cached",
              lastRefreshedAt: data.last_refreshed_at,
              ttlSeconds: Math.max(0, Math.floor((new Date(data.expires_at).getTime() - Date.now()) / 1000)),
            },
            accountHealthScore: score,
            findingsForPanel: cachedData.findingsForPanel || [],
            servicesAssessed: cachedData.servicesAssessed || [],
          });
        }
      } catch (err) {
        console.warn("[useChat] Error fetching unified audit cache:", err);
      }
    };

    fetchLatestAudit();
  }, [credentials?.identity?.account]);

  // Load messages from DB when active conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setAuditSummary(null);
      setLiveRunbook(null);
      setExecutionLogs([]);
      currentMessagesConvIdRef.current = null;
      return;
    }

    if (justCreatedConvRef.current === conversationId) {
      justCreatedConvRef.current = null;
      currentMessagesConvIdRef.current = conversationId;
      return;
    }

    console.log("[useChat] useEffect conversationId changed:", conversationId);
    currentMessagesConvIdRef.current = conversationId;
    
    // Clear transient states and previous conversation messages immediately to avoid flicker
    setMessages([]);
    setAuditSummary(null);
    setLiveRunbook(null);
    setExecutionLogs([]);

    (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("messages" as any)
      .select("*")
      .eq("conversation_id", conversationId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .order("created_at", { ascending: true }) as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        console.log("[useChat] supabase messages fetch returned:", { data, error });
        // If the conversation was switched again while fetching, ignore this old response
        if (currentMessagesConvIdRef.current !== conversationId) {
          console.log("[useChat] stale conversationId branch ignored:", conversationId);
          return;
        }

        if (data) {
          setMessages(
            data.map((m: any) => ({
              id: m.id,
              role: m.role as MessageRole,
              content: m.content,
              status: "complete" as MessageStatus,
              timestamp: new Date(m.created_at),
            }))
          );
        } else {
          setMessages([]);
        }
      });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setLiveRunbook(null);
      return;
    }

    let isActive = true;

    const refreshRunbook = async () => {

      const { data: executions } = await (supabase
        .from("runbook_executions" as any)
        .select("*")
        .eq("conversation_id", conversationId)
        .order("updated_at", { ascending: false })
        .limit(1) as any);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const execution = (executions as any[])?.[0];
      if (!isActive || !execution) {
        if (isActive) setLiveRunbook(null);
        return;
      }


      const { data: steps } = await (supabase
        .from("runbook_execution_steps" as any)
        .select("*")
        .eq("execution_id", execution.id)
        .order("step_order", { ascending: true }) as any);

      if (!isActive) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typedSteps = (steps || []) as any[];
      setLiveRunbook({
        id: execution.id,
        runbookId: execution.runbook_id,
        runbookName: execution.runbook_name,
        status: execution.status,
        dryRun: execution.dry_run,
        currentStepIndex: execution.current_step_index,
        lastError: execution.last_error,
        updatedAt: execution.updated_at,
        steps: typedSteps.map((step) => ({
          id: step.id,
          stepId: step.step_id,
          stepName: step.step_name,
          status: step.status,
          risk: step.risk,
          output: step.output,
          stepOrder: step.step_order,
          updatedAt: step.updated_at,
        })),
      });
    };

    refreshRunbook();

    const channel = supabase
      .channel(`runbook-live-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "runbook_executions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          refreshRunbook();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "runbook_execution_steps",
        },
        () => {
          refreshRunbook();
        },
      )
      .subscribe();

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const sendMessage = useCallback(
    async (
      content: string,
      credentials: AwsCredentials | null,
      convId?: string | null
    ) => {
      if (!credentials) return;

      let targetConvId = convId ?? conversationId;

      if (!targetConvId && createConversation) {
        const title = content.length > 65 ? content.slice(0, 65) + "…" : content;
        try {
          const conv = await createConversation(title);
          if (conv) {
            targetConvId = conv.id;
            justCreatedConvRef.current = conv.id;
            if (onConversationCreated) {
              onConversationCreated(conv.id);
            }
          }
        } catch (err) {
          console.error("Failed to create conversation in sendMessage:", err);
        }
      }

      const userMsg: ChatMessageData = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        status: "complete",
        timestamp: new Date(),
      };

      const assistantId = crypto.randomUUID();
      let assistantContent = "";

      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: "assistant" as const,
          content: "",
          status: "streaming" as const,
          timestamp: new Date(),
        },
      ]);
      setIsLoading(true);

      // Persist user message immediately
      if (targetConvId) {
        (supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("messages" as any)
          .insert({
            id: userMsg.id,
            conversation_id: targetConvId,
            role: "user",
            content,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any) as any).then();
      }

      const upsertAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: assistantContent } : m
          )
        );
      };

      try {
        const historyForApi = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));
        setAuditSummary(null);
        setExecutionLogs([]);

        // Only send session credentials — never raw keys
        const sessionCreds = credentials.session;
        if (!sessionCreds) {
          throw new Error("No valid session credentials. Please re-authenticate your AWS credentials.");
        }

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          throw new Error("No active session. Please sign in again.");
        }

        const customGeminiKey = localStorage.getItem("cloudpilot-gemini-api-key");

        const resp = await fetch(
          `${supabaseUrl}/functions/v1/aws-agent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              apikey: supabaseAnonKey,
            },
            body: JSON.stringify({
              messages: historyForApi,
              credentials: sessionCreds,
              notificationEmail: notificationEmail || null,
              conversationId: targetConvId || null,
              geminiApiKey: customGeminiKey || null,
            }),
          }
        );

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `Request failed (${resp.status})`);
        }

        if (!resp.body) throw new Error("No response body");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              streamDone = true;
              break;
            }

            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.error) {
                const backendErr = new Error(parsed.error);
                (backendErr as any).isBackendError = true;
                throw backendErr;
              }
              const auditMeta = parsed.meta?.auditSummary as AuditSummary | undefined;
              if (auditMeta) {
                setAuditSummary(auditMeta);
              }
              const logs = parsed.meta?.executionLogs;
              if (logs) {
                setExecutionLogs(logs);
              }
              const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (delta) upsertAssistant(delta);
            } catch (err: any) {
              if (err && (err.isBackendError || (err instanceof Error && !err.message.includes("JSON") && err.name !== "SyntaxError"))) {
                throw err;
              }
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        if (!assistantContent) {
          assistantContent = "**No response returned from the agent.** The execution may have been interrupted or blocked by the AWS API. Please check the live security execution logs above for details.";
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: assistantContent, status: "complete" as const } : m
          )
        );

        // Persist completed assistant message
        if (targetConvId && assistantContent) {
          (supabase
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .from("messages" as any)
            .insert({
              id: assistantId,
              conversation_id: targetConvId,
              role: "assistant",
              content: assistantContent,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any) as any).then();

          (supabase
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .from("conversations" as any)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ updated_at: new Date().toISOString() } as any)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .eq("id", targetConvId) as any).then();
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        const errorContent = `**Error:** ${err.message || "Something went wrong"}`;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: errorContent, status: "error" as const }
                : m
            );
          }
          return [
            ...prev,
            {
              id: assistantId,
              role: "assistant" as const,
              content: errorContent,
              status: "error" as const,
              timestamp: new Date(),
            },
          ];
        });
      } finally {
        setIsLoading(false);
      }
    },
    [messages, conversationId, notificationEmail]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setAuditSummary(null);
  }, []);
  const findings: Finding[] = (auditSummary?.findingsForPanel || []).map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    title: finding.title,
    resource: finding.resource,
    timestamp: new Date(finding.timestamp),
    fixPrompt: finding.fixPrompt,
  }));

  return { messages, isLoading, sendMessage, clearMessages, auditSummary, findings, liveRunbook, executionLogs };
};
