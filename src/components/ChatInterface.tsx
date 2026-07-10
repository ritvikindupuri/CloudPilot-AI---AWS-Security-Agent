import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, PanelRightOpen, PanelRightClose, LogOut, History, FileText, Gauge, Settings2, Users, CreditCard, ClipboardCheck, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import ChatMessage from "@/components/ChatMessage";
import ThinkingIndicator from "@/components/ThinkingIndicator";
import QuickActions from "@/components/QuickActions";
import AwsCredentialsPanel, { type AwsCredentials } from "@/components/AwsCredentialsPanel";
import VpcRoutingDialog from "@/components/VpcRoutingDialog";
import FindingsPanel, { type Finding } from "@/components/FindingsPanel";
import StatusBar from "@/components/StatusBar";
import ChatHistoryPanel from "@/components/ChatHistoryPanel";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import NotificationSettings from "@/components/NotificationSettings";
import OnboardingWizard from "@/components/OnboardingWizard";
import MfaSetup from "@/components/MfaSetup";
import WebhookSettings from "@/components/WebhookSettings";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import { useChatHistory } from "@/hooks/useChatHistory";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ChatInterface = () => {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [credentials, setCredentials] = useState<AwsCredentials | null>(() => {
    try {
      const saved = localStorage.getItem("cloudpilot-aws-credentials");
      return saved && saved !== "undefined" ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to parse credentials from local storage", e);
      return null;
    }
  });
  const [showSidebar, setShowSidebar] = useState(true);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    return !localStorage.getItem("cloudpilot-onboarding-complete");
  });
  const [notificationEmail, setNotificationEmail] = useState<string>(() => {
    return localStorage.getItem("cloudpilot-notification-email") || "";
  });
  const [showVpcDialog, setShowVpcDialog] = useState(false);
  const [vpcRoutingStatus, setVpcRoutingStatus] = useState<"inactive" | "requested">(() => {
    return localStorage.getItem("cloudpilot-vpc-status") === "requested" ? "requested" : "inactive";
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [subscriptionTier, setSubscriptionTier] = useState<string>("free");

  const { user, signOut } = useAuth();

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) return;
      try {
        const { data: membership } = await supabase
          .from("org_members")
          .select("org_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (membership?.org_id) {
          const { data: sub } = await supabase
            .from("subscriptions")
            .select("plan_name, status")
            .eq("org_id", membership.org_id)
            .maybeSingle();

          if (sub && sub.status === "active") {
            setSubscriptionTier(sub.plan_name);
          } else {
            setSubscriptionTier("free");
          }
        }
      } catch (err) {
        console.error("Failed to load subscription status:", err);
      }
    };
    fetchSubscription();
  }, [user]);
  const {
    conversations,
    loading: historyLoading,
    createConversation,
    deleteConversation,
    clearAllHistory,
  } = useChatHistory(user);

  const handleSignOut = async () => {
    localStorage.removeItem("cloudpilot-aws-credentials");
    await signOut();
  };

  const { messages, isLoading, sendMessage, clearMessages, auditSummary, findings, liveRunbook } = useChat(
    currentConvId,
    notificationEmail,
    createConversation,
    setCurrentConvId
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const startNewChat = () => {
    setCurrentConvId(null);
    clearMessages();
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConvId(id);
  };

  const handleCredentialsSave = (creds: AwsCredentials) => {
    setCredentials(creds);
    localStorage.setItem("cloudpilot-aws-credentials", JSON.stringify(creds));
    if (vpcRoutingStatus === "inactive") {
      setShowVpcDialog(true);
    }
  };

  const handleVpcAccept = async () => {
    setShowVpcDialog(false);
    setVpcRoutingStatus("requested");
    localStorage.setItem("cloudpilot-vpc-status", "requested");
    toast.info("VPC routing request sent. This flow is currently guided through the agent and is not a verified PrivateLink activation check.");

    // Auto-trigger VPC setup message
    const prompt = "Please route the AI agent through my AWS VPC by automatically setting up a VPC, subnets, and security groups in my environment. Explain what you are setting up and then confirm when the setup is active.";
    let convId = currentConvId;
    if (!convId && user) {
      try {
        const conv = await createConversation("Route AI Agent through VPC");
        convId = conv?.id ?? null;
        setCurrentConvId(convId);
      } catch {}
    }
    await sendMessage(prompt, credentials, convId);
  };

  const handleVpcRemove = async () => {
    const prompt = "Please remove the AWS VPC setup that was created to route the agent. Take down the VPC, subnets, and security groups to avoid any charges.";
    let convId = currentConvId;
    if (!convId && user) {
      try {
        const conv = await createConversation("Remove AWS VPC Setup");
        convId = conv?.id ?? null;
        setCurrentConvId(convId);
      } catch {}
    }
    await sendMessage(prompt, credentials, convId);
    setVpcRoutingStatus("inactive");
    localStorage.removeItem("cloudpilot-vpc-status");
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    if (currentConvId === id) {
      setCurrentConvId(null);
      clearMessages();
    }
  };

  const handleClearAll = async () => {
    await clearAllHistory();
    setCurrentConvId(null);
    clearMessages();
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || !credentials?.session) return;
    setInput("");

    await sendMessage(trimmed, credentials, currentConvId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
      }
    }, 0);
  };

  const handleSaveNotificationEmail = (email: string) => {
    setNotificationEmail(email);
    localStorage.setItem("cloudpilot-notification-email", email);
  };

  const handleAddToS3 = useCallback(async (content: string, messageId: string) => {
    if (!credentials?.session) {
      toast.error("AWS session credentials required. Please re-authenticate.");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        throw new Error("No active session. Please sign in again.");
      }

      const customGeminiKey = localStorage.getItem("cloudpilot-gemini-api-key");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/aws-agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            messages: [
              {
                role: "user",
                content: `Archive the following report to the centralized S3 bucket (cloudpilot-reports-<account-id>). Create the bucket if it doesn't exist. Upload as markdown with key "reports/${new Date().toISOString().slice(0, 10)}/${messageId}.md". Only perform the S3 archival — do NOT regenerate the report. Respond with a brief confirmation of the S3 upload location.\n\n---\n\n${content}`,
              },
            ],
            credentials: credentials.session,
            notificationEmail: null,
            geminiApiKey: customGeminiKey || null,
          }),
        }
      );

      if (!resp.ok) throw new Error("S3 upload request failed");

      // Consume the stream but we don't need to display it
      const reader = resp.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      toast.success("Report archived to S3 bucket");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error("Failed to archive report to S3: " + (err.message || "Unknown error"));
      throw err;
    }
  }, [credentials]);

  // Determine if we should show the thinking indicator
  const showThinking = isLoading && (messages.length === 0 || messages[messages.length - 1]?.role === "user");

  const hasMessages = messages.length > 0;
  const userEmail = user?.email ?? "";
  const userLabel = userEmail.includes("@") ? userEmail.split("@")[0] : userEmail;

  const scoreColor = !auditSummary
    ? "text-muted-foreground"
    : auditSummary.accountHealthScore >= 85
    ? "text-primary"
    : auditSummary.accountHealthScore >= 65
    ? "text-warning"
    : "text-destructive";

  return (
    <div className="flex flex-col h-screen max-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center flex-shrink-0">
            <CloudPilotLogo className="w-7 h-7 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-foreground tracking-tight">CloudPilot AI</h1>
              <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border tracking-wider">v1.0</span>
            </div>
            <p className="text-[10px] text-muted-foreground">AWS Cloud Security Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={startNewChat}
            className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/reports")}
            className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
          >
            <FileText className="w-3.5 h-3.5" />
            Reports
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/operations")}
            className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Operations
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/compliance")}
            className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Compliance
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/team")}
            className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
          >
            <Users className="w-3.5 h-3.5" />
            Team
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/billing")}
            className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Billing
          </Button>

          {userLabel && (
            <span className="hidden md:block text-[11px] text-muted-foreground px-2 font-mono">
              {userLabel}
            </span>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSidebar(!showSidebar)}
            className="text-muted-foreground h-8 w-8"
          >
            {showSidebar ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {!hasMessages && !currentConvId ? (
              <div className="flex flex-col items-center justify-center h-full px-6 py-12 max-w-2xl mx-auto">
                <div className="text-center space-y-5 mb-8">
                  <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center mx-auto glow-primary">
                    <CloudPilotLogo className="w-12 h-12 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight mb-2">CloudPilot AI</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                      Real-time AWS security operations. Connect your credentials to audit, investigate, and remediate cloud infrastructure.
                    </p>
                  </div>
                </div>

                {!credentials && (
                  <div className="w-full max-w-sm mb-8">
                    <AwsCredentialsPanel credentials={credentials} onSave={handleCredentialsSave} />
                  </div>
                )}

                {credentials && (
                  <div className="w-full animate-fade-in-up space-y-4">
                    <div className="border border-border rounded-xl bg-card/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Account Health</p>
                          <div className="flex items-end gap-2 mt-1">
                            <span className={`text-3xl font-bold ${scoreColor}`}>
                              {auditSummary ? auditSummary.accountHealthScore : "—"}
                            </span>
                            <span className="text-sm text-muted-foreground mb-1">/ 100</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {auditSummary
                              ? `${auditSummary.totals.overallRisk} overall risk across ${auditSummary.totals.findings} findings`
                              : "Run the Unified Audit quick action to populate the live score and findings summary."}
                          </p>
                        </div>
                        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <Gauge className="w-5 h-5 text-primary" />
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 mt-4">
                        {[
                          { label: "CRIT", value: auditSummary?.totals.severityCounts.CRITICAL ?? 0, className: "text-destructive" },
                          { label: "HIGH", value: auditSummary?.totals.severityCounts.HIGH ?? 0, className: "text-severity-high" },
                          { label: "MED", value: auditSummary?.totals.severityCounts.MEDIUM ?? 0, className: "text-severity-medium" },
                          { label: "LOW", value: auditSummary?.totals.severityCounts.LOW ?? 0, className: "text-severity-low" },
                        ].map((item) => (
                          <div key={item.label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                            <p className={`text-sm font-bold ${item.className}`}>{item.value}</p>
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{item.label}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid gap-1.5 text-[11px] text-muted-foreground">
                        <p>Quick queries:</p>
                        <button onClick={() => handleQuickAction("Show me everything wrong with my AWS account. Run a formal unified audit across IAM, S3, security groups, EC2, and cost exposure. Return a neatly formatted report with an executive summary, top three issues, recommended fix order, and notable patterns.")} className="text-left hover:text-primary transition-colors">show me everything wrong</button>
                        <button onClick={() => handleQuickAction("What are my security issues? Run a formal unified audit focused on IAM, S3, security groups, and EC2 exposure, and return a neatly formatted report.")} className="text-left hover:text-primary transition-colors">what are my security issues</button>
                        <button onClick={() => handleQuickAction("Where am I wasting money? Run a formal unified audit focused on cost and EC2 waste, and return a neatly formatted report.")} className="text-left hover:text-primary transition-colors">where am I wasting money</button>
                        <button onClick={() => handleQuickAction("Am I SOC2 ready? Run a formal compliance-focused unified audit covering IAM, S3, security groups, EC2, encryption, and logging gaps, and return a checklist-style report.")} className="text-left hover:text-primary transition-colors">am I SOC2 ready</button>
                      </div>

                      {auditSummary && (
                        <p className="text-[10px] text-muted-foreground font-mono mt-4">
                          Cache: {auditSummary.cache.status} · Last refreshed {new Date(auditSummary.cache.lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>

                    <QuickActions onAction={handleQuickAction} disabled={isLoading} credentials={credentials} />
                  </div>
                )}
              </div>
            ) : (
              <div className="py-2">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-3">
                    <MessageSquare className="w-10 h-10 text-muted-foreground/35 animate-pulse" />
                    <p className="text-xs text-muted-foreground">This session has no message history.</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      onAddToS3={handleAddToS3}
                      onTeardownVpc={() =>
                        handleQuickAction(
                          "Tear down and completely delete every VPC resource you previously created for routing — including all routes, internet gateway detachment + deletion, subnets, route tables, security groups, NAT gateways, released elastic IPs, and finally the VPC itself. Walk dependencies in the correct order so nothing is left behind that could incur charges. Confirm each deletion and return a final summary of what was removed."
                        )
                      }
                    />
                  ))
                )}
                {showThinking && <ThinkingIndicator />}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="px-4 py-3 border-t border-border bg-card/50">
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={credentials ? "Ask about your AWS environment..." : "Connect AWS credentials to begin"}
                  disabled={!credentials || isLoading}
                  rows={1}
                  className="w-full resize-none rounded-lg bg-muted border border-border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15 disabled:opacity-40"
                  style={{ minHeight: "40px", maxHeight: "120px" }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height = Math.min(target.scrollHeight, 120) + "px";
                  }}
                />
              </div>
              <Button
                variant="terminal"
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || !credentials || isLoading}
                className="h-10 w-10 flex-shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <StatusBar
            isConnected={!!credentials}
            region={credentials?.region || "—"}
            messageCount={messages.length}
          />
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <aside className="w-72 border-l border-border bg-card/30 overflow-y-auto scrollbar-thin p-3 space-y-3 hidden lg:flex lg:flex-col">

            {/* New Chat button */}
            <Button
              variant="action"
              size="sm"
              onClick={startNewChat}
              className="w-full flex items-center gap-2 justify-center border-primary/20 text-primary hover:bg-primary/10"
            >
              <Plus className="w-3.5 h-3.5" />
              New Chat
            </Button>

            {/* Chat History */}
            <div className="border border-border rounded-lg bg-card p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <History className="w-3 h-3 text-muted-foreground" />
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">History</p>
              </div>
              <ChatHistoryPanel
                conversations={conversations}
                currentConversationId={currentConvId}
                loading={historyLoading}
                onSelect={handleSelectConversation}
                onDelete={handleDeleteConversation}
                onClearAll={handleClearAll}
              />
            </div>

            {/* AWS Credentials */}
            <AwsCredentialsPanel credentials={credentials} onSave={handleCredentialsSave} compact />

            {/* VPC Routing Management */}
            {credentials && (
              <div className="border border-border rounded-lg bg-card p-3 space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">VPC ROUTING</p>
                {vpcRoutingStatus === "requested" ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-warning font-mono">Status: Requested</p>
                    <p className="text-[10px] text-muted-foreground">
                      Guided setup prompt sent. Verify the actual AWS resources before treating routing as active.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleVpcRemove}
                      disabled={isLoading}
                      className="w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
                    >
                      Remove AWS VPC Setup
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="action"
                    size="sm"
                    onClick={() => setShowVpcDialog(true)}
                    disabled={isLoading}
                    className="w-full text-xs"
                  >
                    Route Agent through VPC
                  </Button>
                )}
              </div>
            )}

            {/* Notification Email Settings */}
            <NotificationSettings email={notificationEmail} onSave={handleSaveNotificationEmail} />

            {/* Webhook Settings (Slack/PagerDuty) */}
            <WebhookSettings />

            {/* MFA Setup */}
            <MfaSetup />

            {auditSummary && (
              <div className="border border-border rounded-lg bg-card p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Health Score</p>
                    <div className="flex items-end gap-1.5 mt-1">
                      <span className={`text-2xl font-bold ${scoreColor}`}>{auditSummary.accountHealthScore}</span>
                      <span className="text-xs text-muted-foreground mb-0.5">/ 100</span>
                    </div>
                  </div>
                  <Gauge className="w-4 h-4 text-primary" />
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  <div className="rounded border border-border bg-muted/40 py-1.5">
                    <p className="text-[11px] font-bold text-destructive">{auditSummary.totals.severityCounts.CRITICAL}</p>
                    <p className="text-[9px] font-mono text-muted-foreground">CRIT</p>
                  </div>
                  <div className="rounded border border-border bg-muted/40 py-1.5">
                    <p className="text-[11px] font-bold text-severity-high">{auditSummary.totals.severityCounts.HIGH}</p>
                    <p className="text-[9px] font-mono text-muted-foreground">HIGH</p>
                  </div>
                  <div className="rounded border border-border bg-muted/40 py-1.5">
                    <p className="text-[11px] font-bold text-severity-medium">{auditSummary.totals.severityCounts.MEDIUM}</p>
                    <p className="text-[9px] font-mono text-muted-foreground">MED</p>
                  </div>
                  <div className="rounded border border-border bg-muted/40 py-1.5">
                    <p className="text-[11px] font-bold text-severity-low">{auditSummary.totals.severityCounts.LOW}</p>
                    <p className="text-[9px] font-mono text-muted-foreground">LOW</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono">
                  Cache: {auditSummary.cache.status} · refreshed {new Date(auditSummary.cache.lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            )}

            {liveRunbook && (
              <div className="border border-border rounded-lg bg-card p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Live Runbook</p>
                    <p className="text-xs font-semibold text-foreground mt-1">{liveRunbook.runbookName}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Status: {liveRunbook.status} · Updated {new Date(liveRunbook.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-mono text-muted-foreground">STEP</p>
                    <p className="text-sm font-bold text-primary">{liveRunbook.currentStepIndex}/{Math.max(liveRunbook.steps.length, 1)}</p>
                  </div>
                </div>

                <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin">
                  {liveRunbook.steps.map((step) => (
                    <div key={step.id} className="rounded border border-border bg-muted/40 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-foreground truncate">
                          {step.stepOrder}. {step.stepName}
                        </p>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase">{step.status}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {step.output || `Risk: ${step.risk}`}
                      </p>
                    </div>
                  ))}
                </div>

                {liveRunbook.lastError && (
                  <p className="text-[10px] text-destructive">{liveRunbook.lastError}</p>
                )}
              </div>
            )}

            {/* Findings */}
            <FindingsPanel
              findings={findings}
              onClear={() => {}}
              onInvestigate={(f) =>
                handleQuickAction(f.fixPrompt || `Investigate finding: ${f.title} on resource ${f.resource}`)
              }
            />

            {/* Quick Actions in sidebar */}
            {credentials && (
              <div>
                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase mb-2 px-1">QUICK ACTIONS</p>
                <QuickActions onAction={handleQuickAction} disabled={isLoading} credentials={credentials} />
              </div>
            )}

            {/* Capabilities */}
            <div className="border border-border rounded-lg bg-card p-3 space-y-2">
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">CAPABILITIES</p>
              <ul className="space-y-1.5">
                {[
                  "Live AWS API execution",
                  "Attack simulation",
                  "Compliance scanning (CIS/NIST/PCI)",
                  "Incident response & forensics",
                  "Remediation commands",
                ].map((cap) => (
                  <li key={cap} className="flex items-center gap-2 text-[11px] text-secondary-foreground">
                    <div className="w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                    {cap}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>

      <VpcRoutingDialog
        open={showVpcDialog}
        onOpenChange={setShowVpcDialog}
        credentials={credentials}
        onAccept={handleVpcAccept}
        onDecline={() => setShowVpcDialog(false)}
        onReAuthenticate={handleCredentialsSave}
      />

      {showOnboarding && (
        <OnboardingWizard
          onComplete={() => {
            setShowOnboarding(false);
            localStorage.setItem("cloudpilot-onboarding-complete", "true");
          }}
          onSkip={() => {
            setShowOnboarding(false);
            localStorage.setItem("cloudpilot-onboarding-complete", "true");
          }}
        />
      )}
    </div>
  );
};

export default ChatInterface;
