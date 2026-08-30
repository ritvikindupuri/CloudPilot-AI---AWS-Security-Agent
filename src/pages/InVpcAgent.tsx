import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Shield,
  Server,
  Activity,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  PlayCircle,
  Copy,
  Download,
  ExternalLink,
  RefreshCcw,
  Sliders,
  ChevronDown,
  ChevronUp,
  FileCode,
  Terminal,
  Cpu,
  Layers,
  Lock,
  ArrowRight,
  ArrowDown,
  ShieldCheck,
  Building2,
  Workflow,
  Sparkles,
  Radio,
  FileText
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface InVpcAgentRecord {
  id: string;
  user_id: string;
  name: string;
  account_id: string;
  region: string;
  vpc_id: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  version: string;
  auto_remediation_enabled: boolean;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

interface InVpcEventRecord {
  id: string;
  agent_id: string;
  account_id: string;
  region: string;
  vpc_id: string;
  event_source: string;
  event_type: string;
  action_taken: "REMEDIATED" | "FLAGGED" | "DRY_RUN" | "IGNORED";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  resource_id: string;
  raw_event: any;
  timestamp: string;
}

const CLOUDFORMATION_SNIPPET = `AWSTemplateFormatVersion: '2010-09-09'
Description: 'CloudPilot In-VPC Mini Agent - Serverless EventBridge & Lambda Security Watchdog'

Parameters:
  CloudPilotEndpoint:
    Type: String
    Default: 'https://api.cloudpilot.ai'
  CloudPilotApiKey:
    Type: String
    NoEcho: true
  VpcId:
    Type: AWS::EC2::VPC::Id
  SubnetIds:
    Type: List<AWS::EC2::Subnet::Id>
  AutoRemediationEnabled:
    Type: String
    Default: 'true'

Resources:
  AgentLambda:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Sub 'cloudpilot-in-vpc-agent-\${AWS::Region}'
      Runtime: nodejs20.x
      Handler: index.handler
      Role: !GetAtt AgentExecutionRole.Arn
      Timeout: 30
      MemorySize: 256
      VpcConfig:
        SecurityGroupIds: [!Ref AgentSecurityGroup]
        SubnetIds: !Ref SubnetIds
      Environment:
        Variables:
          CLOUDPILOT_ENDPOINT: !Ref CloudPilotEndpoint
          CLOUDPILOT_API_KEY: !Ref CloudPilotApiKey
          AUTO_REMEDIATION_ENABLED: !Ref AutoRemediationEnabled
          AWS_ACCOUNT_ID: !Ref 'AWS::AccountId'
          AGENT_REGION: !Ref 'AWS::Region'
          VPC_ID: !Ref VpcId

  SecurityEventsRule:
    Type: AWS::Events::Rule
    Properties:
      Name: !Sub 'cloudpilot-in-vpc-security-events-\${AWS::Region}'
      EventPattern:
        source: ['aws.ec2', 'aws.s3', 'aws.iam']
        detail-type: ['AWS API Call via CloudTrail']
        detail:
          eventName:
            - 'AuthorizeSecurityGroupIngress'
            - 'PutBucketPolicy'
            - 'AttachUserPolicy'
      State: ENABLED
      Targets:
        - Arn: !GetAtt AgentLambda.Arn
          Id: 'CloudPilotAgentLambdaTarget'`;

const TERRAFORM_SNIPPET = `module "cloudpilot_in_vpc_agent" {
  source = "github.com/ritvikindupuri/aws-ai-agent//deploy/terraform"

  aws_region               = "us-east-1"
  vpc_id                   = "vpc-0a1b2c3d4e5f67890"
  subnet_ids               = ["subnet-0a1b2c3d", "subnet-0e4f5a6b"]
  cloudpilot_endpoint      = "https://api.cloudpilot.ai"
  cloudpilot_api_key       = var.cloudpilot_api_key
  auto_remediation_enabled = true
  notification_email       = "security-team@mycompany.com"
}`;

export default function InVpcAgent() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [agents, setAgents] = useState<InVpcAgentRecord[]>([]);
  const [events, setEvents] = useState<InVpcEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [autoRemediation, setAutoRemediation] = useState(true);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [activeArchStep, setActiveArchStep] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<string>("events");
  const [simulationLogs, setSimulationLogs] = useState<
    { time: string; text: string; tone: "info" | "warn" | "error" | "success" }[]
  >([]);
  const [simulationStatus, setSimulationStatus] = useState<"IDLE" | "RUNNING" | "COMPLETED">("IDLE");
  const [lastSimulatedEvent, setLastSimulatedEvent] = useState<string | null>(null);

  const fetchAgentData = async () => {
    try {
      setLoading(true);
      const { data: agentRows } = await (supabase
        .from("in_vpc_agents" as any)
        .select("*")
        .order("created_at", { ascending: false }) as any);

      if (agentRows && agentRows.length > 0) {
        setAgents(agentRows as InVpcAgentRecord[]);
        setAutoRemediation(agentRows[0].auto_remediation_enabled !== false);
      }

      const { data: eventRows } = await (supabase
        .from("in_vpc_events" as any)
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(30) as any);

      if (eventRows) {
        setEvents(eventRows as InVpcEventRecord[]);
      }
    } catch (err) {
      console.warn("[InVpcAgent] Error fetching agent records:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgentData();
  }, []);

  const handleCopy = (type: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    toast.success(`${type} copied to clipboard`);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleSimulateEvent = async (eventType: string) => {
    try {
      setSimulating(true);
      setSimulationStatus("RUNNING");
      setLastSimulatedEvent(eventType);
      setSimulationLogs([]);

      const addLog = (text: string, tone: "info" | "warn" | "error" | "success" = "info") => {
        const time = new Date().toLocaleTimeString();
        setSimulationLogs((prev) => [...prev, { time, text, tone }]);
      };

      if (eventType === "AuthorizeSecurityGroupIngress") {
        addLog("⚡ [EventBridge] Ingested CloudTrail event: ec2.amazonaws.com AuthorizeSecurityGroupIngress", "info");
        await new Promise((r) => setTimeout(r, 220));
        addLog("🔍 [In-VPC Lambda] Spawned in private subnet-0a1b2c3d (< 180ms cold start)", "info");
        await new Promise((r) => setTimeout(r, 260));
        addLog("🛡️ [Policy Engine] Evaluating ingress rules against CIS AWS Foundations Benchmark 5.2...", "warn");
        await new Promise((r) => setTimeout(r, 240));
        addLog("🚨 [DRIFT DETECTED] Unauthorized CIDR 0.0.0.0/0 ingress on port 22 (SSH) on sg-0a9b8c7d6e5f", "error");
        await new Promise((r) => setTimeout(r, 300));
        addLog("⚡ [Auto-Remediation] Executing ec2:RevokeSecurityGroupIngress via AWS SDK on sg-0a9b8c7d6e5f...", "warn");
        await new Promise((r) => setTimeout(r, 320));
      } else if (eventType === "PutBucketPolicy") {
        addLog("⚡ [EventBridge] Ingested CloudTrail event: s3.amazonaws.com PutBucketPolicy", "info");
        await new Promise((r) => setTimeout(r, 220));
        addLog("🔍 [In-VPC Lambda] Analyzing bucket policy on s3://prod-customer-assets", "info");
        await new Promise((r) => setTimeout(r, 260));
        addLog("🚨 [CRITICAL EXPOSURE] Wildcard Principal '*' with s3:GetObject policy detected", "error");
        await new Promise((r) => setTimeout(r, 280));
        addLog("⚡ [Auto-Remediation] Calling s3:PutBucketPublicAccessBlock (4 layers locked)...", "warn");
        await new Promise((r) => setTimeout(r, 320));
      } else {
        addLog("⚡ [EventBridge] Ingested CloudTrail event: iam.amazonaws.com AttachUserPolicy", "info");
        await new Promise((r) => setTimeout(r, 220));
        addLog("🔍 [In-VPC Lambda] Analyzing IAM mutation on user 'deploy-bot'", "info");
        await new Promise((r) => setTimeout(r, 260));
        addLog("⚠️ [SCP Boundary Audit] Direct AdministratorAccess policy flagged against active SCPs", "warn");
        await new Promise((r) => setTimeout(r, 280));
      }

      const res = await fetch("http://localhost:54321/api/in-vpc-agent/simulate-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          agentId: agents[0]?.id || "in-vpc-123456789012-us-east-1",
        }),
      });

      if (!res.ok) throw new Error("Simulation endpoint failed");
      const result = await res.json();

      if (result.event.action_taken === "REMEDIATED") {
        addLog("✅ [SUCCESS] Ingress rule successfully revoked from security group! (Execution: 1.38s)", "success");
      } else {
        addLog("⚠️ [FLAGGED] Event recorded in CloudPilot audit trail & flagged for administrator review.", "warn");
      }

      addLog(`📡 [Telemetry Sync] Telemetry posted to CloudPilot Command Center over TLS 1.3 (Event ID: ${result.eventId})`, "success");
      setSimulationStatus("COMPLETED");

      toast.success(
        result.event.action_taken === "REMEDIATED"
          ? `Event Processed: ${result.event.event_type} auto-remediated!`
          : `Event Logged: ${result.event.event_type}`
      );

      await fetchAgentData();
    } catch (err: any) {
      toast.error("Failed to simulate in-VPC event");
      setSimulationStatus("IDLE");
    } finally {
      setSimulating(false);
    }
  };

  const activeAgent = agents[0] || {
    id: "in-vpc-123456789012-us-east-1",
    name: "Production VPC Guard",
    account_id: "123456789012",
    region: "us-east-1",
    vpc_id: "vpc-0a1b2c3d4e5f67890",
    status: "ONLINE",
    version: "v1.2.0",
    last_heartbeat_at: new Date().toISOString(),
  };

  const remediatedCount = events.filter((e) => e.action_taken === "REMEDIATED").length;
  const criticalCount = events.filter((e) => e.severity === "CRITICAL").length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top App Header */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shadow-xs">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground tracking-tight">CloudPilot In-VPC Mini Agent</h1>
            <p className="text-[11px] text-muted-foreground">Self-Hosted Serverless Guarddog inside your AWS Perimeter</p>
          </div>
        </div>

        {/* Global Navigation Bar */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/app")}
            className="text-xs text-muted-foreground hover:text-foreground h-8"
          >
            Dashboard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/skills")}
            className="text-xs text-muted-foreground hover:text-foreground h-8"
          >
            Skills
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/operations")}
            className="text-xs text-muted-foreground hover:text-foreground h-8"
          >
            Operations
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/compliance")}
            className="text-xs text-muted-foreground hover:text-foreground h-8"
          >
            Compliance
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/reports-history")}
            className="text-xs text-muted-foreground hover:text-foreground h-8"
          >
            Reports
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8 gap-1.5 bg-primary/10 text-primary border-primary/30"
          >
            <Server className="w-3.5 h-3.5" />
            In-VPC Agent
          </Button>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Hero Banner: In-VPC Status Card */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-card via-card/90 to-primary/5 p-5 sm:p-6 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs font-mono px-2.5 py-0.5 gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  {activeAgent.status}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">
                  VPC: <strong className="text-foreground">{activeAgent.vpc_id}</strong>
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  Region: <strong className="text-foreground">{activeAgent.region}</strong>
                </span>
              </div>

              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                In-VPC Security Engine
              </h2>
              <p className="text-xs text-muted-foreground">
                Serverless Lambda & EventBridge watchdog enforcing zero-trust policies and auto-remediation in &lt; 2s.
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={fetchAgentData}
              disabled={loading}
              className="h-8 text-xs gap-1.5 border-border bg-background/50 self-start sm:self-auto"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 mt-4 border-t border-border/50">
            <div className="p-2.5 rounded-xl bg-background/50 border border-border/40">
              <span className="text-[10px] font-mono text-muted-foreground uppercase block">Monitored VPC</span>
              <span className="text-xs font-bold text-foreground font-mono mt-0.5 block truncate">{activeAgent.vpc_id}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-background/50 border border-border/40">
              <span className="text-[10px] font-mono text-muted-foreground uppercase block">Auto-Remediations</span>
              <span className="text-xs font-bold text-emerald-400 font-mono mt-0.5 block">{remediatedCount} Reverted Safely</span>
            </div>
            <div className="p-2.5 rounded-xl bg-background/50 border border-border/40">
              <span className="text-[10px] font-mono text-muted-foreground uppercase block">Critical Interceptions</span>
              <span className="text-xs font-bold text-rose-400 font-mono mt-0.5 block">{criticalCount} High-Risk Events</span>
            </div>
            <div className="p-2.5 rounded-xl bg-background/50 border border-border/40">
              <span className="text-[10px] font-mono text-muted-foreground uppercase block">Avg Latency</span>
              <span className="text-xs font-bold text-primary font-mono mt-0.5 block">&lt; 1.8 seconds</span>
            </div>
          </div>
        </div>

        {/* Tabs Container */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-card/70 border border-border/50 p-1 rounded-xl">
            <TabsTrigger value="events" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
              Live In-VPC Telemetry ({events.length})
            </TabsTrigger>
            <TabsTrigger value="testing" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
              Drift Test Simulator
            </TabsTrigger>
            <TabsTrigger value="cloudformation" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
              1-Click CloudFormation Stack
            </TabsTrigger>
            <TabsTrigger value="terraform" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
              Terraform Module
            </TabsTrigger>
            <TabsTrigger value="architecture" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
              Architecture & Threat Model
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: LIVE IN-VPC TELEMETRY STREAM */}
          <TabsContent value="events" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Real-Time EventBridge Interceptions</h3>
                <p className="text-xs text-muted-foreground">Live stream of CloudTrail security mutations evaluated by your in-VPC agent:</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchAgentData}
                  className="h-8 text-xs gap-1.5 border-border"
                >
                  <RefreshCcw className="w-3 h-3" /> Refresh
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className="rounded-xl border border-border/70 bg-card/60 p-4 space-y-3 hover:border-primary/40 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold ${
                          evt.severity === "CRITICAL"
                            ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                            : evt.severity === "HIGH"
                            ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                            : "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                        }`}
                      >
                        {evt.severity}
                      </span>
                      <span className="text-xs font-bold font-mono text-foreground">{evt.event_type}</span>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {evt.event_source}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono uppercase ${
                          evt.action_taken === "REMEDIATED"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        }`}
                      >
                        {evt.action_taken === "REMEDIATED" ? "✓ AUTO-REMEDIATED" : "⚠ FLAGGED"}
                      </Badge>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-foreground/90 leading-relaxed font-sans">{evt.description}</p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40 text-[11px] font-mono text-muted-foreground">
                    <span className="truncate max-w-md">Resource: <strong className="text-foreground">{evt.resource_id}</strong></span>
                    <button
                      onClick={() => setExpandedEventId(expandedEventId === evt.id ? null : evt.id)}
                      className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    >
                      {expandedEventId === evt.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {expandedEventId === evt.id ? "Hide Raw Payload" : "View Raw EventBridge Payload"}
                    </button>
                  </div>

                  {expandedEventId === evt.id && (
                    <pre className="p-3 rounded-lg bg-background border border-border/60 text-[10px] font-mono text-muted-foreground overflow-x-auto">
                      {JSON.stringify(evt.raw_event, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* TAB: DRIFT TEST SIMULATOR SANDBOX */}
          <TabsContent value="testing" className="space-y-4">
            <div className="rounded-2xl border border-border bg-card/60 p-6 space-y-6">
              <div className="pb-4 border-b border-border/60">
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <PlayCircle className="w-5 h-5 text-primary" /> Post-Deployment Testing & Drift Simulator
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Safely test your in-VPC agent's real-time interception, zero-trust policy checks, and automated remediation without mutating live production resources:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-background/60 border border-border/60 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      <h4 className="text-xs font-bold text-foreground">Port 22 SSH Ingress Drift</h4>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Simulates an unauthorized <code>0.0.0.0/0</code> SSH rule mutation on an EC2 security group and tests instant auto-revocation.
                    </p>
                  </div>
                  <Button
                    onClick={() => handleSimulateEvent("AuthorizeSecurityGroupIngress")}
                    disabled={simulating}
                    className="w-full h-8 text-xs font-semibold gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shadow-sm"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    {simulating ? "Simulating..." : "Test Port 22 Auto-Fix"}
                  </Button>
                </div>

                <div className="p-4 rounded-xl bg-background/60 border border-border/60 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-400" />
                      <h4 className="text-xs font-bold text-foreground">Public S3 Bucket Exposure</h4>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Simulates a wildcard <code>Principal: *</code> S3 bucket policy and tests immediate enforcement of S3 Public Access Block.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleSimulateEvent("PutBucketPolicy")}
                    disabled={simulating}
                    className="w-full h-8 text-xs font-medium gap-1.5 border-border hover:bg-muted rounded-lg"
                  >
                    <PlayCircle className="w-3.5 h-3.5 text-blue-400" />
                    Test Public S3 Auto-Lock
                  </Button>
                </div>

                <div className="p-4 rounded-xl bg-background/60 border border-border/60 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      <h4 className="text-xs font-bold text-foreground">IAM Privilege Escalation</h4>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Simulates direct <code>AdministratorAccess</code> policy attachment on an IAM user and verifies zero-trust SCP boundary flagging.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleSimulateEvent("AttachUserPolicy")}
                    disabled={simulating}
                    className="w-full h-8 text-xs font-medium gap-1.5 border-border hover:bg-muted rounded-lg"
                  >
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    Test IAM SCP Flagging
                  </Button>
                </div>
              </div>

              {/* LIVE REAL-TIME EXECUTION CONSOLE */}
              {(simulationLogs.length > 0 || simulating) && (
                <div className="rounded-xl border border-border/80 bg-background/95 p-4 space-y-3 font-mono shadow-md">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      <span className="text-xs font-bold text-foreground">In-VPC Agent Execution Console</span>
                      {simulating ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                          INTERCEPTING MUTATION...
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          EXECUTION FINISHED (&lt; 1.4s)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSimulationLogs([])}
                        className="h-7 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                      >
                        Clear Console
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setActiveTab("events")}
                        className="h-7 text-[10px] px-2.5 bg-primary text-primary-foreground gap-1"
                      >
                        View in Telemetry Stream <ArrowRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs max-h-64 overflow-y-auto leading-relaxed pt-1 select-text">
                    {simulationLogs.map((log, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="text-muted-foreground/60 text-[10px] shrink-0 font-mono">{log.time}</span>
                        <span
                          className={`${
                            log.tone === "error"
                              ? "text-rose-400 font-semibold"
                              : log.tone === "warn"
                              ? "text-amber-400 font-medium"
                              : log.tone === "success"
                              ? "text-emerald-400 font-semibold"
                              : "text-foreground/90"
                          }`}
                        >
                          {log.text}
                        </span>
                      </div>
                    ))}
                    {simulating && (
                      <div className="flex items-center gap-2 text-muted-foreground text-[11px] animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                        Awaiting next pipeline stage...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 2: 1-CLICK CLOUDFORMATION */}
          <TabsContent value="cloudformation" className="space-y-4">
            <div className="rounded-2xl border border-border bg-card/60 p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
                <div>
                  <h3 className="text-base font-bold text-foreground">Deploy via AWS CloudFormation</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Launch the official CloudPilot In-VPC stack in your AWS account in under 60 seconds.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleCopy("CloudFormation", CLOUDFORMATION_SNIPPET)}
                    className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground"
                  >
                    <Copy className="w-3 h-3" /> {copiedType === "CloudFormation" ? "Copied!" : "Copy YAML"}
                  </Button>
                </div>
              </div>

              {/* Step by step guide */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-background/60 border border-border/50 space-y-1.5">
                  <span className="text-[10px] font-mono text-primary font-bold">STEP 1</span>
                  <h4 className="text-xs font-bold text-foreground">Open AWS CloudFormation</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Navigate to CloudFormation in the AWS Console and click <strong>Create Stack (with new resources)</strong>.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-background/60 border border-border/50 space-y-1.5">
                  <span className="text-[10px] font-mono text-primary font-bold">STEP 2</span>
                  <h4 className="text-xs font-bold text-foreground">Paste Template or Upload</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Select <strong>Upload a template file</strong> and upload <code>deploy/cloudformation/cloudpilot-in-vpc.yaml</code>.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-background/60 border border-border/50 space-y-1.5">
                  <span className="text-[10px] font-mono text-primary font-bold">STEP 3</span>
                  <h4 className="text-xs font-bold text-foreground">Select Target VPC & Subnets</h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Pick your private subnets and set <strong>AutoRemediationEnabled</strong> to <code>true</code>.
                  </p>
                </div>
              </div>

              {/* Code Snippet Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">cloudpilot-in-vpc.yaml</span>
                </div>
                <pre className="p-4 rounded-xl bg-background border border-border/70 text-[11px] font-mono text-foreground/90 overflow-x-auto max-h-96 leading-relaxed">
                  {CLOUDFORMATION_SNIPPET}
                </pre>
              </div>
            </div>
          </TabsContent>

          {/* TAB 3: TERRAFORM MODULE */}
          <TabsContent value="terraform" className="space-y-4">
            <div className="rounded-2xl border border-border bg-card/60 p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
                <div>
                  <h3 className="text-base font-bold text-foreground">Deploy via Terraform</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Include the CloudPilot In-VPC module directly in your company's infrastructure-as-code repository.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleCopy("Terraform", TERRAFORM_SNIPPET)}
                  className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground"
                >
                  <Copy className="w-3 h-3" /> {copiedType === "Terraform" ? "Copied!" : "Copy Terraform"}
                </Button>
              </div>

              {/* Code Snippet Box */}
              <div className="space-y-1.5">
                <span className="text-xs font-mono text-muted-foreground">main.tf</span>
                <pre className="p-4 rounded-xl bg-background border border-border/70 text-[11px] font-mono text-foreground/90 overflow-x-auto leading-relaxed">
                  {TERRAFORM_SNIPPET}
                </pre>
              </div>

              <div className="p-4 rounded-xl bg-background/60 border border-border/50 space-y-2">
                <h4 className="text-xs font-bold text-foreground">Quick Execution:</h4>
                <code className="text-xs font-mono bg-muted px-3 py-2 rounded block text-primary select-all">
                  terraform init && terraform apply -var="cloudpilot_api_key=cp_live_xxxx"
                </code>
              </div>
            </div>
          </TabsContent>

          {/* TAB 4: ARCHITECTURE & THREAT MODEL (VISUAL FLOW DIAGRAM) */}
          <TabsContent value="architecture" className="space-y-6">
            <div className="rounded-2xl border border-border bg-card/60 p-6 sm:p-8 space-y-8">
              {/* Header */}
              <div className="pb-4 border-b border-border/60">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-primary" /> In-VPC Event-Driven Pipeline
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Interactive flow showing how real-time CloudTrail mutations travel through in-VPC EventBridge rules, zero-trust Lambda audits, instant auto-remediation, and encrypted dashboard telemetry:
                </p>
              </div>

              {/* Visual Flow Diagram with Connecting Arrows */}
              <div className="relative">
                {/* Horizontal flow line for large screens */}
                <div className="hidden lg:block absolute top-1/2 left-6 right-6 h-0.5 bg-gradient-to-r from-amber-500/30 via-blue-500/40 via-emerald-500/40 to-purple-500/40 -translate-y-1/2 z-0" />

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 relative z-10">
                  {[
                    {
                      step: 1,
                      name: "EventBridge Trigger",
                      tag: "< 100ms Ingest",
                      badge: "CloudTrail Rule",
                      icon: Radio,
                      color: "text-amber-400",
                      bg: "bg-amber-500/10",
                      border: "border-amber-500/30",
                      glow: "shadow-[0_0_20px_rgba(245,158,11,0.15)]",
                      items: ["EC2 0.0.0.0/0", "Public S3 Policy", "IAM Role Mutate"],
                      summary: "Catches real-time AWS API mutations from CloudTrail matching zero-trust security filters.",
                    },
                    {
                      step: 2,
                      name: "In-VPC Lambda Agent",
                      tag: "< 200ms Boot",
                      badge: "Node.js 20.x",
                      icon: Cpu,
                      color: "text-blue-400",
                      bg: "bg-blue-500/10",
                      border: "border-blue-500/30",
                      glow: "shadow-[0_0_20px_rgba(59,130,246,0.15)]",
                      items: ["CIS Benchmarks", "Zero-Trust Check", "Private Subnet"],
                      summary: "Boots securely inside your private VPC subnets to evaluate drift against security benchmarks.",
                    },
                    {
                      step: 3,
                      name: "Safe Auto-Remediation",
                      tag: "< 2s Execution",
                      badge: "AWS SDK Mutate",
                      icon: ShieldCheck,
                      color: "text-emerald-400",
                      bg: "bg-emerald-500/10",
                      border: "border-emerald-500/30",
                      glow: "shadow-[0_0_20px_rgba(16,185,129,0.15)]",
                      items: ["Revoke Port 22/3389", "Block S3 Access", "SNS Alert"],
                      summary: "Neutralizes high-risk exposures instantly via least-privilege AWS SDK calls.",
                    },
                    {
                      step: 4,
                      name: "Telemetry Dashboard Sync",
                      tag: "TLS 1.3 Sync",
                      badge: "Zero-Storage",
                      icon: Server,
                      color: "text-purple-400",
                      bg: "bg-purple-500/10",
                      border: "border-purple-500/30",
                      glow: "shadow-[0_0_20px_rgba(168,85,247,0.15)]",
                      items: ["Live Event Stream", "Audit Logging", "SOC 2 Evidence"],
                      summary: "Streams encrypted execution logs and audit records directly to your CloudPilot dashboard.",
                    },
                  ].map((node, idx) => {
                    const NodeIcon = node.icon;
                    const isSelected = activeArchStep === node.step;

                    return (
                      <div key={node.step} className="flex flex-col items-center">
                        <div
                          onClick={() => setActiveArchStep(node.step)}
                          className={`w-full rounded-2xl border p-4 flex flex-col justify-between gap-3 cursor-pointer transition-all duration-200 backdrop-blur-md ${
                            isSelected
                              ? `${node.border} ${node.bg} ${node.glow} ring-2 ring-primary/40 scale-[1.02]`
                              : "border-border/60 bg-card/70 hover:border-primary/40 hover:bg-card/90"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${node.bg} ${node.border} ${node.color}`}>
                              <NodeIcon className="w-4 h-4" />
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-background/80 text-muted-foreground border border-border/40">
                              STAGE {node.step}
                            </span>
                          </div>

                          <div>
                            <span className="text-xs font-bold text-foreground block">{node.name}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[10px] font-mono font-medium ${node.color}`}>{node.badge}</span>
                              <span className="text-muted-foreground text-[10px]">•</span>
                              <span className="text-[10px] font-mono text-muted-foreground">{node.tag}</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1 pt-1 border-t border-border/30">
                            {node.items.map((it) => (
                              <span key={it} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-background/60 text-muted-foreground border border-border/30">
                                {it}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Mobile connector arrow */}
                        {idx < 3 && (
                          <div className="lg:hidden flex items-center justify-center py-2 text-primary">
                            <ArrowDown className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stage Deep Dive Inspector */}
              <div className="p-5 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h4 className="text-xs font-bold text-foreground font-mono">
                      Stage {activeArchStep} Deep Dive:{" "}
                      {activeArchStep === 1 && "EventBridge Ingestion & Security Filter"}
                      {activeArchStep === 2 && "Serverless Zero-Trust Inspection Engine"}
                      {activeArchStep === 3 && "Automated Safe Remediation & SNS Alerting"}
                      {activeArchStep === 4 && "Zero-Storage Dashboard Synchronization"}
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/25">
                    Click any stage above to inspect
                  </span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {activeArchStep === 1 &&
                    "CloudTrail delivers all AWS management events directly to Amazon EventBridge. A dedicated rule pattern filters for high-risk actions (security group ingress, S3 bucket policies, IAM role attachments), eliminating 99% of cloud noise before invoking Lambda."}
                  {activeArchStep === 2 &&
                    "The in-VPC Lambda initializes in < 200ms within your private subnet. It connects to the AWS EC2, S3, and IAM APIs to evaluate the event against CIS AWS Foundations Benchmark controls and your custom zero-trust rules."}
                  {activeArchStep === 3 &&
                    "When high-risk misconfigurations (e.g. 0.0.0.0/0 on port 22/3389 or public bucket policies) are confirmed, the agent calls ec2:RevokeSecurityGroupIngress or s3:PutBucketPublicAccessBlock to neutralize the threat in under 2 seconds, while dispatching an SNS notification."}
                  {activeArchStep === 4 &&
                    "The agent constructs an immutable telemetry record containing event ID, resource ID, action taken, and before/after diffs, posting it over TLS 1.3 to your CloudPilot dashboard. No raw AWS credentials or customer data ever leaves your VPC."}
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
