import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, PanelRightOpen, PanelRightClose, LogOut, History, FileText, Gauge, Settings2, Users, CreditCard, ClipboardCheck, MessageSquare, Check, Key, ChevronRight, Sparkles } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import { useChatHistory } from "@/hooks/useChatHistory";
import { toast } from "sonner";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/integrations/supabase/client";

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
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
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

  const { messages, isLoading, sendMessage, clearMessages, auditSummary, findings, liveRunbook, executionLogs } = useChat(
    currentConvId,
    credentials,
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
    
    setVpcRoutingStatus("inactive");
    localStorage.removeItem("cloudpilot-vpc-status");

    let convId = currentConvId;
    if (!convId && user) {
      try {
        const conv = await createConversation("Remove AWS VPC Setup");
        convId = conv?.id ?? null;
        setCurrentConvId(convId);
      } catch {}
    }
    try {
      await sendMessage(prompt, credentials, convId);
    } catch (err) {
      console.error("VPC removal request failed:", err);
    }
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

  const [scanMode, setScanMode] = useState<"fast" | "deep">("fast");

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || !credentials?.session) return;
    setInput("");

    await sendMessage(trimmed, credentials, currentConvId, scanMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = async (prompt: string) => {
    setIsQuickActionsOpen(false);
    setInput("");
    await sendMessage(prompt, credentials, currentConvId, scanMode);
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
        `${supabaseUrl}/functions/v1/aws-agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: supabaseAnonKey,
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
  const showThinking = isLoading && (
    messages.length === 0 || 
    messages[messages.length - 1]?.role === "user" ||
    (messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content)
  );

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
              <div className="flex flex-col items-center justify-start h-full px-6 py-8 max-w-3xl mx-auto space-y-8 scrollbar-thin overflow-y-auto">
                
                {/* Header */}
                <div className="text-center space-y-4 mt-2">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto glow-primary">
                    <CloudPilotLogo className="w-10 h-10 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">CloudPilot Getting Started</h2>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1 leading-relaxed">
                      Follow these four simple interactive steps to analyze, secure, monitor, and audit your AWS cloud infrastructure.
                    </p>
                  </div>
                </div>

                {/* Interactive Steps Grid */}
                <div className="w-full grid gap-4">
                  
                  {/* STEP 1: Connect AWS Account */}
                  <div className={`border rounded-xl p-4 transition-all duration-200 bg-card/60 ${
                    credentials ? 'border-green-500/20 bg-green-500/[0.01]' : 'border-border'
                  }`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          credentials ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'
                        }`}>
                          {credentials ? <Check className="w-4 h-4" /> : <Key className="w-4 h-4" />}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                            Step 1: Connect your AWS Account
                            {credentials && <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded font-mono">Connected</span>}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {credentials 
                              ? `Active session using Access Key ID ${credentials.displayKeyPrefix || "role"}... in region ${credentials.region}.`
                              : "Enter temporary session tokens or an IAM role. Raw credentials are never stored or exposed."}
                          </p>
                        </div>
                      </div>
                      
                      {credentials && (
                        <button 
                          onClick={() => {
                            localStorage.removeItem("cloudpilot-aws-credentials");
                            setCredentials(null);
                            toast.success("Disconnected from AWS account.");
                          }}
                          className="text-[10px] text-muted-foreground hover:text-destructive border border-border px-2.5 py-1 rounded-md transition-all hover:border-destructive/30 flex-shrink-0"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>

                    {!credentials && (
                      <div className="mt-4 pt-3 border-t border-border/40 max-w-md">
                        <AwsCredentialsPanel credentials={credentials} onSave={handleCredentialsSave} />
                      </div>
                    )}
                  </div>

                  {/* STEP 2: Run Security Scan */}
                  <div className={`border rounded-xl p-4 transition-all duration-200 ${
                    !credentials 
                      ? 'border-border/30 opacity-50 bg-muted/5' 
                      : auditSummary 
                        ? 'border-green-500/20 bg-green-500/[0.01]' 
                        : 'border-border bg-card/60'
                  }`}>
                    <div className="flex gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        !credentials 
                          ? 'bg-muted text-muted-foreground' 
                          : auditSummary 
                            ? 'bg-green-500/10 text-green-400' 
                            : 'bg-primary/10 text-primary'
                      }`}>
                        {auditSummary ? <Check className="w-4 h-4" /> : <Gauge className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                          Step 2: Run first security audit
                          {auditSummary && <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded font-mono">Score: {auditSummary.accountHealthScore}/100</span>}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Analyze your AWS configurations across IAM, S3, Security Groups, and Costs to map compliance and compute your health score.
                        </p>

                        {credentials && !auditSummary && (
                          <div className="mt-3">
                            <Button 
                              variant="terminal" 
                              size="xs" 
                              onClick={() => handleQuickAction("Show me everything wrong with my AWS account. Run a formal unified audit across IAM, S3, security groups, EC2, and cost exposure. Return a neatly formatted report with an executive summary, top three issues, recommended fix order, and notable patterns.")}
                              disabled={isLoading}
                              className="font-mono text-xs"
                            >
                              Run Account Security Scan
                            </Button>
                          </div>
                        )}

                        {auditSummary && (
                          <div className="mt-4 pt-3 border-t border-border/40 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="space-y-1">
                                <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Account Health Score</p>
                                <div className="flex items-baseline gap-1">
                                  <span className={`text-2xl font-black ${scoreColor}`}>
                                    {auditSummary.accountHealthScore}
                                  </span>
                                  <span className="text-xs text-muted-foreground">/ 100</span>
                                </div>
                              </div>
                              <div className="grid grid-cols-4 gap-1.5">
                                {[
                                  { label: "CRIT", value: auditSummary.totals.severityCounts.CRITICAL, className: "text-destructive" },
                                  { label: "HIGH", value: auditSummary.totals.severityCounts.HIGH, className: "text-severity-high" },
                                  { label: "MED", value: auditSummary.totals.severityCounts.MEDIUM, className: "text-severity-medium" },
                                  { label: "LOW", value: auditSummary.totals.severityCounts.LOW, className: "text-severity-low" },
                                ].map((item) => (
                                  <div key={item.label} className="rounded border border-border/80 bg-muted/40 px-2 py-1 text-center min-w-[50px]">
                                    <p className={`text-xs font-black ${item.className}`}>{item.value}</p>
                                    <p className="text-[8px] font-mono text-muted-foreground">{item.label}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
                              <p className="text-[10px] text-muted-foreground leading-normal font-mono">
                                Findings: {auditSummary.totals.findings} total · Overall Risk: {auditSummary.totals.overallRisk} · Refreshed {new Date(auditSummary.cache.lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </p>
                              <Button
                                variant="terminal"
                                size="xs"
                                onClick={() => navigate("/report/latest")}
                                className="font-mono text-[10px] px-2 py-1 h-auto flex items-center gap-1.5"
                              >
                                <FileText className="w-3.5 h-3.5 text-primary animate-pulse" />
                                View Security Report
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* STEP 3: Ask & Remediate */}
                  <div className={`border rounded-xl p-4 transition-all duration-200 ${
                    !auditSummary 
                      ? 'border-border/30 opacity-50 bg-muted/5' 
                      : 'border-border bg-card/60'
                  }`}>
                    <div className="flex gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        !auditSummary ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                      }`}>
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold">Step 3: Analyze results & remediate</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Ask CloudPilot any security questions, or use quick actions to inspect S3 exposure, evaluate IAM privilege escalation, or generate CLI remedies.
                        </p>

                        {auditSummary && (
                          <div className="mt-4 pt-3 border-t border-border/40 space-y-4">
                            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">Curated Query Templates</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {[
                                { text: "Am I SOC2 ready?", q: "Am I SOC2 ready? Run a formal compliance-focused unified audit covering IAM, S3, security groups, EC2, encryption, and logging gaps, and return a checklist-style report." },
                                { text: "Find cost anomalies", q: "Find cost anomalies in my AWS account. Pull the recent cost breakdown, identify spikes or accelerating trends, check for idle EC2 instances, and return a formal summary with recommended actions." },
                                { text: "Enforce IMDSv2", q: "Enforce IMDSv2 across all EC2 instances using real API calls. Query all instances and their MetadataOptions (HttpTokens setting). For each instance with HttpTokens=optional (IMDSv1 enabled), provide the exact AWS CLI command to enforce IMDSv2." },
                                { text: "Check S3 exposure", q: "Query all S3 buckets in the account using real AWS API calls. For each bucket check: public access block settings, bucket ACL, bucket policy (identify external principals), default encryption, versioning status, access logging, and replication." }
                              ].map((item) => (
                                <button
                                  key={item.text}
                                  onClick={() => handleQuickAction(item.q)}
                                  disabled={isLoading}
                                  className="text-left border border-border rounded-lg p-2.5 hover:bg-muted/40 hover:text-primary transition-all text-xs font-medium flex items-center justify-between gap-2 min-w-0"
                                >
                                  <span className="truncate">{item.text}</span>
                                  <ChevronRight className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                                </button>
                              ))}
                            </div>

                            <div className="pt-2 flex justify-start">
                              <Dialog open={isQuickActionsOpen} onOpenChange={setIsQuickActionsOpen}>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="font-mono text-xs">
                                    Browse all 35+ Quick Actions
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                                  <DialogHeader>
                                    <DialogTitle>CloudPilot Quick Actions Catalog</DialogTitle>
                                    <DialogDescription>
                                      Select any pre-built security audit, compliance mapping, or attack simulation playbooks to run on your AWS account.
                                    </DialogDescription>
                                  </DialogHeader>
                                  <div className="mt-4">
                                    <QuickActions onAction={handleQuickAction} disabled={isLoading} credentials={credentials} />
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* STEP 4: Explore Dashboards & Walkthroughs */}
                  <div className={`border rounded-xl p-4 transition-all duration-200 ${
                    !auditSummary 
                      ? 'border-border/30 opacity-50 bg-muted/5' 
                      : 'border-border bg-card/60'
                  }`}>
                    <div className="flex gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        !auditSummary ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                      }`}>
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                          Step 4: Explore Dashboards & Run Walkthroughs
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Navigate to the <span className="font-semibold text-foreground">Reports</span>, <span className="font-semibold text-foreground">Operations</span>, and <span className="font-semibold text-foreground">Compliance</span> tabs in the top header. 
                          Click the <span className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">Start Tour</span> button on those pages to launch the interactive walkthroughs and learn about their features!
                        </p>

                        {auditSummary && (
                          <div className="mt-3 flex gap-2 flex-wrap">
                            <Button 
                              variant="outline" 
                              size="xs" 
                              onClick={() => navigate("/operations")}
                              className="text-xs"
                            >
                              Go to Operations
                            </Button>
                            <Button 
                              variant="outline" 
                              size="xs" 
                              onClick={() => navigate("/compliance")}
                              className="text-xs"
                            >
                              Go to Compliance
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>

              </div>
            ) : (
              <div className="py-2">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-3">
                    <MessageSquare className="w-10 h-10 text-muted-foreground/35 animate-pulse" />
                    <p className="text-xs text-muted-foreground">This session has no message history.</p>
                  </div>
                ) : (
                  messages
                    .filter((msg) => !(msg.role === "assistant" && !msg.content))
                    .map((msg) => (
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
                {showThinking && <ThinkingIndicator logs={executionLogs} />}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Scan Mode Selector & Quick Actions Control Bar */}
          <div className="px-4 py-2 border-t border-border bg-card/70 flex items-center justify-between gap-2 max-w-3xl mx-auto text-xs">
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border/40">
              <button
                type="button"
                onClick={() => setScanMode("fast")}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all flex items-center gap-1 ${
                  scanMode === "fast"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>⚡ Fast Scan (Sonnet 3.5)</span>
              </button>
              <button
                type="button"
                onClick={() => setScanMode("deep")}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all flex items-center gap-1 ${
                  scanMode === "deep"
                    ? "bg-blue-600 text-white font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>🔍 Deep Audit (Opus / Extended Reasoning)</span>
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsQuickActionsOpen(true)}
              className="text-[11px] h-7 gap-1 text-primary border-primary/30 hover:bg-primary/10"
            >
              <Sparkles className="w-3 h-3" /> Quick Actions
            </Button>
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
                <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-border/40">
                  <p className="text-[9px] text-muted-foreground font-mono">
                    refreshed {new Date(auditSummary.cache.lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <Button
                    variant="terminal"
                    size="xs"
                    onClick={() => navigate("/report/latest")}
                    className="font-mono text-[9px] px-2 py-0.5 h-auto flex items-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5 text-primary animate-pulse" />
                    Open Report
                  </Button>
                </div>
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
