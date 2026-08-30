import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Shield,
  ShieldCheck,
  Search,
  Plus,
  Copy,
  Check,
  Code2,
  Cpu,
  Layers,
  Wand2,
  Terminal,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Settings2,
  FileText,
  ClipboardCheck,
  Users,
  LogOut,
  Trash2,
  Edit3,
  CheckCircle2,
  ExternalLink,
  BookOpen,
  Zap,
  Sliders,
  Eye,
  Info,
  DollarSign,
  GitCompare,
  Building2,
  Crosshair,
  BellRing,
  Bot,
  Activity,
  ArrowRight,
  Lock,
  Workflow,
  Radio,
  Server,
  ArrowDown,
  AlertTriangle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

interface BuiltInSkill {
  id: string;
  name: string;
  badge: string;
  intentKey: string;
  category: "Security" | "FinOps" | "Governance" | "Automation" | "Red Team" | "General";
  description: string;
  allowedTools: string[];
  sampleQuery: string;
  systemSupplement: string;
  icon: any;
  iconTheme: {
    text: string;
    bg: string;
    border: string;
    glow: string;
  };
}

interface CustomSkillRecord {
  id: string;
  user_id: string;
  name: string;
  badge: string;
  description: string;
  intent_key: string;
  system_supplement: string;
  allowed_tools: string[];
  trigger_keywords: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    id: "security_audit",
    name: "Security Audit Specialist",
    badge: "Security Audit Specialist",
    intentKey: "security_audit",
    category: "Security",
    description: "Evaluates comprehensive cloud posture across IAM, S3, EC2, and VPC with CIS benchmark mappings and CLI remedies.",
    allowedTools: ["execute_aws_api", "run_security_scan", "query_cloudtrail", "manage_drift_baseline"],
    sampleQuery: "Audit my S3 buckets, security groups, and IAM roles against CIS Benchmark standards.",
    icon: ShieldCheck,
    iconTheme: {
      text: "text-cyan-400",
      bg: "bg-cyan-500/10",
      border: "border-cyan-500/30",
      glow: "shadow-[0_0_15px_rgba(6,182,212,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: Security Audit Specialist
You are now operating as an elite AWS security auditor. Your priorities in this query are:
1. Enumerate all security misconfigurations across IAM, S3, EC2, and VPC with explicit resource IDs.
2. Map every finding to CIS Benchmark controls and severity levels (CRITICAL/HIGH/MEDIUM/LOW).
3. Provide a concise remediation command for each finding.
4. Output a structured findings table before any narrative summary.
Do NOT skip resource IDs or use placeholder values. Real findings only.`,
  },
  {
    id: "cost_analysis",
    name: "FinOps Cost Analyst",
    badge: "FinOps Cost Analyst",
    intentKey: "cost_analysis",
    category: "FinOps",
    description: "Inspects AWS Cost Explorer daily spend, isolates statistical cost anomalies, and surfaces ROI-prioritized savings.",
    allowedTools: ["execute_aws_api", "run_cost_anomaly_scan", "manage_cost_rule"],
    sampleQuery: "Find cost anomalies and idle EC2 instances in my account over the past 14 days.",
    icon: DollarSign,
    iconTheme: {
      text: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      glow: "shadow-[0_0_15px_rgba(16,185,129,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: FinOps Cost Analyst
You are now operating as a FinOps cost optimization expert. Your priorities:
1. Break down spend by service, region, and resource with exact dollar amounts from the Cost Explorer API.
2. Flag idle or over-provisioned resources with their monthly cost impact.
3. Prioritize savings recommendations by ROI (highest savings first).
4. Always include the specific API calls that retrieved each cost figure.`,
  },
  {
    id: "drift_detection",
    name: "Drift Detection Engineer",
    badge: "Drift Detection Engineer",
    intentKey: "drift_detection",
    category: "Security",
    description: "Calculates cryptographic state fingerprints and diffs live resources against captured security baselines.",
    allowedTools: ["execute_aws_api", "run_drift_scan", "manage_drift_baseline"],
    sampleQuery: "Compare current security groups and S3 buckets against my baseline and show configuration drift.",
    icon: GitCompare,
    iconTheme: {
      text: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      glow: "shadow-[0_0_15px_rgba(245,158,11,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: Drift Detection Engineer
You are now operating as a configuration drift detection engineer. Your priorities:
1. Compare current resource state against the captured baseline snapshot.
2. List every changed resource with its before/after configuration diff.
3. Flag any drift that introduces a new security exposure with HIGH priority.
4. Output a structured drift table with timestamps, resource IDs, and change type.`,
  },
  {
    id: "org_management",
    name: "AWS Organizations Expert",
    badge: "AWS Organizations Expert",
    intentKey: "org_management",
    category: "Governance",
    description: "Navigates multi-account hierarchy, audits Service Control Policies (SCPs), and validates organization-wide guardrails.",
    allowedTools: ["execute_aws_api", "manage_service_control_policy", "manage_iam_permission_boundary"],
    sampleQuery: "Map my AWS Organization hierarchy and audit SCPs for missing root/OU guardrails.",
    icon: Building2,
    iconTheme: {
      text: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/30",
      glow: "shadow-[0_0_15px_rgba(168,85,247,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: AWS Organizations Expert
You are now operating as an AWS Organizations and multi-account governance specialist. Your priorities:
1. Map the full organizational unit (OU) hierarchy with account IDs.
2. Audit Service Control Policies (SCPs) for gaps in enforcement.
3. Flag any account lacking MFA enforcement or CloudTrail coverage.
4. Provide specific SCP JSON snippets for any recommended enforcement changes.`,
  },
  {
    id: "ops_automation",
    name: "Incident Response Operator",
    badge: "Incident Response Operator",
    intentKey: "ops_automation",
    category: "Automation",
    description: "Executes automated incident response runbooks with explicit confirmation gates before mutating infrastructure.",
    allowedTools: ["execute_aws_api", "execute_runbook", "query_cloudtrail", "manage_event_policy"],
    sampleQuery: "Run incident response playbook to isolate compromised EC2 instance i-0123456789abcdef0.",
    icon: Zap,
    iconTheme: {
      text: "text-yellow-400",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/30",
      glow: "shadow-[0_0_15px_rgba(234,179,8,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: Incident Response Operator
You are now operating as an incident response and runbook execution specialist. Your priorities:
1. Execute the requested runbook steps in strict sequence with real API calls.
2. Log each action taken with its resource ID and outcome.
3. Pause and request explicit user confirmation before any destructive or mutating action.
4. After execution, summarize all actions taken and resources affected in a structured table.`,
  },
  {
    id: "attack_simulation",
    name: "Red Team Simulation Expert",
    badge: "Red Team Simulation Expert",
    intentKey: "attack_simulation",
    category: "Red Team",
    description: "Evaluates live IAM policies and trust relationships to discover potential privilege escalation paths, lateral movement vectors, and MITRE ATT&CK mappings.",
    allowedTools: ["execute_aws_api", "run_attack_simulation", "query_cloudtrail"],
    sampleQuery: "Simulate privilege escalation paths on IAM roles and map potential lateral movement.",
    icon: Crosshair,
    iconTheme: {
      text: "text-rose-400",
      bg: "bg-rose-500/10",
      border: "border-rose-500/30",
      glow: "shadow-[0_0_15px_rgba(244,63,94,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: Red Team Simulation Expert
You are now operating as an authorized red team penetration tester. Your priorities:
1. Execute privilege escalation path discovery using real IAM API calls.
2. Map all lateral movement opportunities across roles, policies, and trust relationships.
3. Simulate attack phases (Recon → Exploit → Persist → Exfil) with explicit API call evidence.
4. Provide a structured attack path report with MITRE ATT&CK technique mappings.`,
  },
  {
    id: "event_automation",
    name: "Event Automation Specialist",
    badge: "Event Automation Specialist",
    intentKey: "event_automation",
    category: "Automation",
    description: "Parses CloudTrail event telemetry and generates real-time EventBridge auto-remediation policies.",
    allowedTools: ["execute_aws_api", "manage_event_policy", "query_cloudtrail"],
    sampleQuery: "If anyone modifies S3 public access block or opens port 22, create an automation rule to auto-remediate.",
    icon: BellRing,
    iconTheme: {
      text: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/30",
      glow: "shadow-[0_0_15px_rgba(59,130,246,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: CloudTrail Event Automation Specialist
You are now operating as a CloudTrail event automation and response policy engineer. Your priorities:
1. Retrieve and analyze relevant CloudTrail events with exact timestamps and source IPs.
2. Define or modify event response policies with explicit condition logic.
3. Validate that any new automation rule does not conflict with existing SCPs or IAM boundaries.
4. Output the rule definition in both human-readable and JSON policy format.`,
  },
  {
    id: "direct_query",
    name: "Direct Query Agent",
    badge: "Direct Query Agent",
    intentKey: "direct_query",
    category: "General",
    description: "Single-pass execution model for targeted AWS resource inspection with raw structured tables and exact ARNs.",
    allowedTools: ["execute_aws_api"],
    sampleQuery: "List all EC2 instances in us-east-1 with their private IPs and instance states.",
    icon: Terminal,
    iconTheme: {
      text: "text-indigo-400",
      bg: "bg-indigo-500/10",
      border: "border-indigo-500/30",
      glow: "shadow-[0_0_15px_rgba(99,102,241,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: Direct Query Agent
You are now operating as a precise AWS resource query agent. Your priorities:
1. Execute the exact API call requested with minimal tool calls (prefer single-pass).
2. Return raw, structured output (tables or JSON) rather than narrative prose.
3. Include resource IDs, ARNs, regions, and creation timestamps in all responses.
4. If the query is ambiguous, execute the most specific interpretation and note alternatives.`,
  },
  {
    id: "general",
    name: "General Cloud Security Assistant",
    badge: "General Cloud Security Assistant",
    intentKey: "general",
    category: "General",
    description: "Full-capability generalist mode with access to all 15 security tools for multi-domain queries and exploratory conversations.",
    allowedTools: ["All 15 AWS Security Tools"],
    sampleQuery: "Explain my overall AWS cloud architecture and suggest immediate security hardening priorities.",
    icon: Bot,
    iconTheme: {
      text: "text-teal-400",
      bg: "bg-teal-500/10",
      border: "border-teal-500/30",
      glow: "shadow-[0_0_15px_rgba(20,184,166,0.15)]",
    },
    systemSupplement: `ACTIVE SKILL: General Cloud Security Assistant
You are operating in general mode. Use your full tool set and provide a comprehensive, well-structured response covering all relevant aspects of the user's query.`,
  },
];

const PRESET_TEMPLATES = [
  {
    name: "Kubernetes & EKS Cluster Hardener",
    badge: "EKS Security Hardener",
    description: "Audits Amazon EKS clusters, OIDC IAM role bindings, worker node security groups, and public API endpoint exposure.",
    intent_key: "eks_security",
    trigger_keywords: ["eks", "k8s", "kubernetes", "cluster", "pod", "container"],
    allowed_tools: ["execute_aws_api", "run_security_scan", "query_cloudtrail"],
    system_supplement: `ACTIVE SKILL: Kubernetes & EKS Cluster Hardener
You are an expert in Amazon EKS container security and Kubernetes cloud governance.
Your priorities:
1. Audit EKS cluster endpoint access (public vs private VPC endpoint).
2. Inspect IAM OIDC provider associations and verify least-privilege pod roles.
3. Review worker node security groups and IMDSv2 configuration on EC2 instances.
4. Map findings against the CIS Amazon EKS Benchmark.`,
  },
  {
    name: "HIPAA Cloud Health Data Guard",
    badge: "HIPAA Compliance Guard",
    description: "Specialized auditor for HIPAA/HITECH healthcare workloads, checking S3 PHI encryption, KMS CMKs, and CloudTrail immutability.",
    intent_key: "hipaa_guard",
    trigger_keywords: ["hipaa", "healthcare", "phi", "patient", "hitech", "health data"],
    allowed_tools: ["execute_aws_api", "run_security_scan", "query_cloudtrail", "manage_drift_baseline"],
    system_supplement: `ACTIVE SKILL: HIPAA Cloud Health Data Guard
You are a specialized HIPAA Technical Safeguards auditor for AWS healthcare infrastructure.
Your priorities:
1. Verify 100% KMS Customer Managed Key (CMK) encryption on all S3 buckets and RDS databases storing health records.
2. Ensure TLS 1.2+ is enforced on all load balancers and S3 bucket policies.
3. Validate CloudTrail log file validation and multi-region trail immutability with S3 Object Lock.
4. Structure report strictly according to HIPAA 45 CFR § 164.312 Technical Safeguards.`,
  },
  {
    name: "Serverless FinOps Scout",
    badge: "Serverless FinOps Scout",
    description: "Optimizes AWS Lambda concurrency, provisioned capacity, DynamoDB on-demand vs provisioned, and API Gateway caching.",
    intent_key: "serverless_finops",
    trigger_keywords: ["lambda", "serverless", "dynamodb", "api gateway", "step functions", "concurrency"],
    allowed_tools: ["execute_aws_api", "run_cost_anomaly_scan", "manage_cost_rule"],
    system_supplement: `ACTIVE SKILL: Serverless FinOps Scout
You are a serverless cost optimization specialist.
Your priorities:
1. Identify over-provisioned Lambda memory settings and suggest Power Tuning configurations.
2. Flag unused Lambda provisioned concurrency and underutilized DynamoDB capacity.
3. Check CloudWatch log retention periods on serverless log groups to prevent infinite storage waste.
4. Deliver an ROI table ranking serverless cost optimizations by monthly savings.`,
  },
];

const ALL_AVAILABLE_TOOLS = [
  "execute_aws_api",
  "run_security_scan",
  "run_cost_anomaly_scan",
  "run_drift_scan",
  "manage_drift_baseline",
  "manage_cost_rule",
  "manage_event_policy",
  "run_attack_simulation",
  "execute_runbook",
  "query_cloudtrail",
  "manage_service_control_policy",
  "manage_iam_permission_boundary",
];

const TOOL_METADATA: Record<string, { label: string; description: string; service: string }> = {
  execute_aws_api: {
    label: "execute_aws_api",
    service: "Core AWS SDK",
    description: "Invokes official AWS SDK APIs (EC2, S3, IAM, CloudWatch, RDS, VPC, Lambda, etc.) using live temporary session credentials.",
  },
  run_security_scan: {
    label: "run_security_scan",
    service: "CIS Benchmark",
    description: "Executes automated multi-service security audits evaluating CIS AWS Foundations Benchmark controls.",
  },
  run_cost_anomaly_scan: {
    label: "run_cost_anomaly_scan",
    service: "Cost Explorer",
    description: "Pulls daily spend metrics, identifies cost spikes or accelerating trends, and checks for idle cloud resources.",
  },
  run_drift_scan: {
    label: "run_drift_scan",
    service: "Config Drift",
    description: "Calculates live cryptographic state fingerprints and diffs them against previously captured security baselines.",
  },
  manage_drift_baseline: {
    label: "manage_drift_baseline",
    service: "Config Baseline",
    description: "Captures, saves, or resets infrastructure configuration snapshots used as baseline standards.",
  },
  manage_cost_rule: {
    label: "manage_cost_rule",
    service: "FinOps Rules",
    description: "Sets budget limits, spending anomaly threshold rules, and automated SNS email alerts.",
  },
  manage_event_policy: {
    label: "manage_event_policy",
    service: "EventBridge",
    description: "Defines event triggers and automated remediation rules responding to real-time CloudTrail security events.",
  },
  run_attack_simulation: {
    label: "run_attack_simulation",
    service: "Red Team",
    description: "Analyzes live IAM policies and trust relationships to discover potential privilege escalation and lateral movement attack paths without destructive mutations.",
  },
  execute_runbook: {
    label: "execute_runbook",
    service: "Incident Response",
    description: "Executes structured incident response playbooks sequentially with confirmation gates before mutating infrastructure.",
  },
  query_cloudtrail: {
    label: "query_cloudtrail",
    service: "CloudTrail",
    description: "Retrieves and parses historical AWS CloudTrail audit logs with timestamps, source IPs, and identity contexts.",
  },
  manage_service_control_policy: {
    label: "manage_service_control_policy",
    service: "AWS Organizations",
    description: "Audits, crafts, and attaches Service Control Policies (SCPs) across organization accounts and OUs.",
  },
  manage_iam_permission_boundary: {
    label: "manage_iam_permission_boundary",
    service: "IAM Governance",
    description: "Evaluates and attaches IAM permission boundaries to cap maximum permissions and enforce least privilege.",
  },
};

export default function Skills() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [customSkills, setCustomSkills] = useState<CustomSkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeDiagramStage, setActiveDiagramStage] = useState<number>(2);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formBadge, setFormBadge] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIntentKey, setFormIntentKey] = useState("");
  const [formKeywords, setFormKeywords] = useState("");
  const [formAllowedTools, setFormAllowedTools] = useState<string[]>([]);
  const [formSystemSupplement, setFormSystemSupplement] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Load custom skills from DB
  const loadCustomSkills = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from("custom_skills" as any)
        .select("*")
        .order("created_at", { ascending: false }) as any);

      if (error) {
        console.warn("Error loading custom skills:", error);
      } else if (Array.isArray(data)) {
        const parsed: CustomSkillRecord[] = data.map((item: any) => {
          let allowed: string[] = [];
          let keywords: string[] = [];
          try {
            allowed = Array.isArray(item.allowed_tools)
              ? item.allowed_tools
              : JSON.parse(item.allowed_tools || "[]");
          } catch { /* ignore */ }
          try {
            keywords = Array.isArray(item.trigger_keywords)
              ? item.trigger_keywords
              : JSON.parse(item.trigger_keywords || "[]");
          } catch { /* ignore */ }

          return {
            id: item.id,
            user_id: item.user_id || "",
            name: item.name || "Custom Skill",
            badge: item.badge || item.name,
            description: item.description || "",
            intent_key: item.intent_key || item.name.toLowerCase().replace(/\s+/g, "_"),
            system_supplement: item.system_supplement || "",
            allowed_tools: allowed,
            trigger_keywords: keywords,
            is_active: item.is_active === true || item.is_active === "true",
            created_at: item.created_at || new Date().toISOString(),
            updated_at: item.updated_at || new Date().toISOString(),
          };
        });
        setCustomSkills(parsed);
      }
    } catch (err) {
      console.error("Failed to load skills:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomSkills();
  }, []);

  const handleCopyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success("Skill prompt directives copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTryInChat = (query: string) => {
    sessionStorage.setItem("cloudpilot-prefill-prompt", query);
    navigate("/app");
  };

  const handleOpenCreateModal = (preset?: typeof PRESET_TEMPLATES[0]) => {
    if (preset) {
      setFormName(preset.name);
      setFormBadge(preset.badge);
      setFormDescription(preset.description);
      setFormIntentKey(preset.intent_key);
      setFormKeywords(preset.trigger_keywords.join(", "));
      setFormAllowedTools(preset.allowed_tools);
      setFormSystemSupplement(preset.system_supplement);
    } else {
      setFormName("");
      setFormBadge("Custom Security Auditor");
      setFormDescription("");
      setFormIntentKey("");
      setFormKeywords("");
      setFormAllowedTools(["execute_aws_api", "run_security_scan"]);
      setFormSystemSupplement(`ACTIVE SKILL: Custom Security Auditor
You are an expert cloud security specialist with specialized directives.
Your priorities:
1. Identify all security exposures with explicit resource IDs.
2. Structure recommendations by priority and impact.
3. Provide exact AWS CLI commands to remediate each issue.`);
    }
    setEditingSkillId(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (skill: CustomSkillRecord) => {
    setEditingSkillId(skill.id);
    setFormName(skill.name);
    setFormBadge(skill.badge);
    setFormDescription(skill.description);
    setFormIntentKey(skill.intent_key);
    setFormKeywords(skill.trigger_keywords.join(", "));
    setFormAllowedTools(skill.allowed_tools);
    setFormSystemSupplement(skill.system_supplement);
    setIsModalOpen(true);
  };

  const handleSaveSkill = async () => {
    if (!formName.trim()) {
      toast.error("Skill name is required");
      return;
    }
    if (!formSystemSupplement.trim()) {
      toast.error("Skill system supplement prompt is required");
      return;
    }

    setIsSaving(true);
    try {
      const keywordsArray = formKeywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0);

      const payload = {
        name: formName.trim(),
        badge: formBadge.trim() || formName.trim(),
        description: formDescription.trim(),
        intent_key: formIntentKey.trim() || formName.trim().toLowerCase().replace(/[^a-z0-9]/g, "_"),
        system_supplement: formSystemSupplement.trim(),
        allowed_tools: JSON.stringify(formAllowedTools.length > 0 ? formAllowedTools : ["execute_aws_api"]),
        trigger_keywords: JSON.stringify(keywordsArray),
        is_active: true,
        user_id: user?.id || "local-user",
        updated_at: new Date().toISOString(),
      };

      if (editingSkillId) {
        const { error } = await (supabase
          .from("custom_skills" as any)
          .update(payload as any)
          .eq("id", editingSkillId) as any);

        if (error) throw error;
        toast.success(`Custom skill "${formName}" updated successfully`);
      } else {
        const newId = crypto.randomUUID();
        const { error } = await (supabase
          .from("custom_skills" as any)
          .insert({
            id: newId,
            ...payload,
            created_at: new Date().toISOString(),
          } as any) as any);

        if (error) throw error;
        toast.success(`Custom skill "${formName}" created and active!`);
      }

      setIsModalOpen(false);
      await loadCustomSkills();
    } catch (err: any) {
      console.error("Save skill error:", err);
      toast.error(err.message || "Failed to save custom skill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleSkill = async (id: string, currentActive: boolean) => {
    try {
      const nextActive = !currentActive;
      const { error } = await (supabase
        .from("custom_skills" as any)
        .update({ is_active: nextActive, updated_at: new Date().toISOString() } as any)
        .eq("id", id) as any);

      if (error) throw error;
      setCustomSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, is_active: nextActive } : s))
      );
      toast.success(nextActive ? "Skill activated" : "Skill disabled");
    } catch (err: any) {
      toast.error("Failed to update skill status");
    }
  };

  const handleDeleteSkill = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete custom skill "${name}"?`)) return;

    try {
      const { error } = await (supabase
        .from("custom_skills" as any)
        .delete()
        .eq("id", id) as any);

      if (error) throw error;
      setCustomSkills((prev) => prev.filter((s) => s.id !== id));
      toast.success(`Deleted skill "${name}"`);
    } catch (err: any) {
      toast.error("Failed to delete skill");
    }
  };

  const filteredBuiltInSkills = useMemo(() => {
    return BUILT_IN_SKILLS.filter((skill) => {
      const matchesCategory = selectedCategory === "All" || skill.category === selectedCategory;
      const matchesSearch =
        !searchQuery ||
        skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.intentKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.allowedTools.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const filteredCustomSkills = useMemo(() => {
    return customSkills.filter((skill) => {
      const matchesSearch =
        !searchQuery ||
        skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.trigger_keywords.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase())) ||
        skill.allowed_tools.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesSearch;
    });
  }, [searchQuery, customSkills]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Top Header Navigation */}
      <header className="h-14 border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/app" className="flex items-center gap-2 font-mono font-bold text-sm tracking-tight text-foreground hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
              <Shield className="w-4 h-4" />
            </div>
            <span>CloudPilot<span className="text-primary">.ai</span></span>
          </Link>

          <span className="text-xs text-muted-foreground/50">/</span>
          <span className="text-xs font-mono font-medium text-foreground flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
            Skills Catalog
          </span>
        </div>

        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app")} className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs">
            <Terminal className="w-3.5 h-3.5" />
            Dashboard
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate("/reports")} className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs">
            <FileText className="w-3.5 h-3.5" />
            Reports
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate("/operations")} className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs">
            <Settings2 className="w-3.5 h-3.5" />
            Operations
          </Button>

          {/* Active Skills Button */}
          <Button variant="secondary" size="sm" className="flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium bg-primary/15 text-primary border border-primary/30">
            <Sparkles className="w-3.5 h-3.5" />
            Skills
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate("/compliance")} className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs">
            <ClipboardCheck className="w-3.5 h-3.5" />
            Compliance
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate("/in-vpc-agent")} className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs">
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            In-VPC Agent
          </Button>

          <Button variant="ghost" size="sm" onClick={() => navigate("/team")} className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs">
            <Users className="w-3.5 h-3.5" />
            Team
          </Button>

          <div className="w-[1px] h-4 bg-border mx-1" />

          <Button variant="ghost" size="icon" onClick={() => signOut()} className="text-muted-foreground hover:text-foreground h-8 w-8" title="Sign out">
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card/90 via-card/50 to-primary/5 p-6 sm:p-8 backdrop-blur-xl shadow-xl">
          <div className="relative z-10 max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono font-medium bg-primary/10 text-primary border border-primary/25">
              <Wand2 className="w-3 h-3" />
              Dynamic Persona Injection Engine • Stage 2 of 5
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Agent Skills & Persona Studio
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Explore how CloudPilot dynamically transforms from a general AI into specialized domain experts. Inspect built-in prompt directives, or author custom specialist skills with scoped toolsets and trigger rules.
            </p>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-border/50">
            <div className="bg-background/40 rounded-xl p-3 border border-border/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Built-in Skills</span>
              <p className="text-xl font-bold font-mono text-foreground mt-0.5">9 Personas</p>
            </div>
            <div className="bg-background/40 rounded-xl p-3 border border-border/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Custom Skills</span>
              <p className="text-xl font-bold font-mono text-primary mt-0.5">{customSkills.length} Created</p>
            </div>
            <div className="bg-background/40 rounded-xl p-3 border border-border/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tool Reduction</span>
              <p className="text-xl font-bold font-mono text-emerald-400 mt-0.5">~80% Noise Cut</p>
            </div>
            <div className="bg-background/40 rounded-xl p-3 border border-border/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Safety Layer</span>
              <p className="text-xl font-bold font-mono text-cyan-400 mt-0.5">Pre-Screened</p>
            </div>
          </div>
        </div>

        {/* Search, Filter & Action Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by skill name, tools, or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card/60 border-border/60 text-xs h-9 rounded-xl focus-visible:ring-primary/40"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleOpenCreateModal()}
              className="h-9 text-xs font-semibold gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl shadow-md"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Custom Skill
            </Button>
          </div>
        </div>

        {/* Tabs Container */}
        <Tabs defaultValue="builtin" className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <TabsList className="bg-card/70 border border-border/50 p-1 rounded-xl">
              <TabsTrigger value="builtin" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                Built-in Personas ({BUILT_IN_SKILLS.length})
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                Custom Studio ({customSkills.length})
              </TabsTrigger>
              <TabsTrigger value="architecture" className="text-xs font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                Engine Architecture
              </TabsTrigger>
            </TabsList>

            {/* Category Filter Pills (Only shown in built-in tab) */}
            <div className="hidden lg:flex items-center gap-1.5">
              {["All", "Security", "FinOps", "Governance", "Automation", "Red Team"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg font-mono transition-colors ${
                    selectedCategory === cat
                      ? "bg-muted font-bold text-foreground border border-border"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* TAB 1: BUILT-IN SKILLS */}
          <TabsContent value="builtin" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBuiltInSkills.map((skill) => {
                const isExpanded = expandedSkillId === skill.id;
                const IconComponent = skill.icon;

                return (
                  <div
                    key={skill.id}
                    className="flex flex-col rounded-2xl border border-border/70 bg-card/60 hover:border-primary/40 transition-all duration-200 overflow-hidden shadow-sm hover:shadow-md group"
                  >
                    {/* Card Header with Cyber Themed Icon Box */}
                    <div className="p-5 flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-transform duration-200 group-hover:scale-105 ${skill.iconTheme.bg} ${skill.iconTheme.border} ${skill.iconTheme.text} ${skill.iconTheme.glow}`}>
                            <IconComponent className="w-4 h-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold tracking-tight text-foreground">{skill.name}</h3>
                            <span className="text-[10px] font-mono text-muted-foreground">{skill.intentKey}</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] font-mono uppercase bg-background/60">
                          {skill.category}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {skill.description}
                      </p>

                      {/* Tool Badges with Hover Tooltip */}
                      <div className="pt-1">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1.5">
                          Allowed Tools ({skill.allowedTools.length}):
                        </span>
                        <TooltipProvider delayDuration={100}>
                          <div className="flex flex-wrap gap-1">
                            {skill.allowedTools.map((t) => {
                              const meta = TOOL_METADATA[t];
                              return (
                                <Tooltip key={t}>
                                  <TooltipTrigger asChild>
                                    <span
                                      className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted/70 text-foreground/80 border border-border/40 hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-help"
                                    >
                                      {t}
                                    </span>
                                  </TooltipTrigger>
                                  {meta && (
                                    <TooltipContent side="top" className="max-w-xs p-3 space-y-1 bg-card/95 border-border shadow-xl backdrop-blur-md">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-xs font-bold text-primary">{meta.label}</span>
                                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">{meta.service}</span>
                                      </div>
                                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        {meta.description}
                                      </p>
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              );
                            })}
                          </div>
                        </TooltipProvider>
                      </div>
                    </div>

                    {/* Expandable Prompt Supplement Drawer */}
                    {isExpanded && (
                      <div className="px-5 pb-4 space-y-2 animate-in fade-in duration-200 border-t border-border/40 bg-muted/20 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-primary font-bold flex items-center gap-1">
                            <Code2 className="w-3 h-3" /> Injected System Supplement:
                          </span>
                          <button
                            onClick={() => handleCopyPrompt(skill.id, skill.systemSupplement)}
                            className="text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            {copiedId === skill.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            {copiedId === skill.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-muted-foreground bg-background/80 p-3 rounded-xl border border-border/60 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                          {skill.systemSupplement}
                        </pre>
                      </div>
                    )}

                    {/* Card Footer Actions */}
                    <div className="px-5 py-3 border-t border-border/50 bg-background/30 flex items-center justify-between gap-2 text-xs">
                      <button
                        onClick={() => setExpandedSkillId(isExpanded ? null : skill.id)}
                        className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {isExpanded ? "Hide Directives" : "View Directives"}
                      </button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTryInChat(skill.sampleQuery)}
                        className="h-7 text-[11px] font-medium gap-1 text-primary border-primary/30 hover:bg-primary/10"
                      >
                        <PlayCircle className="w-3 h-3" />
                        Run in Chat
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* TAB 2: CUSTOM SKILLS STUDIO */}
          <TabsContent value="custom" className="space-y-6">
            {/* Template Presets Banner */}
            <div className="rounded-2xl border border-border bg-card/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-400" /> Quick-Start Skill Templates
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Click any preset template to customize and activate it for your account.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {PRESET_TEMPLATES.map((tmpl) => (
                  <div
                    key={tmpl.name}
                    className="p-3.5 rounded-xl border border-border/60 bg-background/50 hover:border-primary/50 transition-all flex flex-col justify-between gap-3"
                  >
                    <div>
                      <span className="text-xs font-bold text-foreground block">{tmpl.name}</span>
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                        {tmpl.description}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleOpenCreateModal(tmpl)}
                      className="w-full text-[11px] h-7 font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25"
                    >
                      Use Template →
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Skills List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  Your Custom Personas ({customSkills.length})
                </h3>
                <Button
                  size="sm"
                  onClick={() => handleOpenCreateModal()}
                  className="h-8 text-xs font-medium gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> New Skill
                </Button>
              </div>

              {loading ? (
                <div className="py-12 text-center text-xs text-muted-foreground">Loading custom skills...</div>
              ) : filteredCustomSkills.length === 0 ? (
                <div className="py-12 border border-dashed border-border rounded-2xl text-center space-y-3 bg-card/20">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">No Custom Skills Created Yet</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Create specialized specialist personas with custom compliance directives, persona prompts, and keyword triggers.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => handleOpenCreateModal()} className="text-xs">
                    <Plus className="w-3.5 h-3.5 mr-1" /> Create Your First Skill
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredCustomSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className={`rounded-2xl border transition-all p-5 flex flex-col justify-between gap-4 ${
                        skill.is_active
                          ? "border-primary/40 bg-card/70 shadow-sm"
                          : "border-border/50 bg-card/20 opacity-60"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 text-primary flex items-center justify-center">
                              <Wand2 className="w-4 h-4" />
                            </div>
                            <div>
                              <span className="text-sm font-bold text-foreground block">{skill.name}</span>
                              <span className="text-[10px] font-mono text-muted-foreground">
                                Intent: {skill.intent_key}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={skill.is_active}
                              onCheckedChange={() => handleToggleSkill(skill.id, skill.is_active)}
                              aria-label="Toggle active"
                            />
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {skill.description || "No description provided."}
                        </p>

                        {/* Keywords */}
                        {skill.trigger_keywords.length > 0 && (
                          <div>
                            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
                              Trigger Keywords:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {skill.trigger_keywords.map((k) => (
                                <span
                                  key={k}
                                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20"
                                >
                                  {k}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Allowed Tools with Hover Tooltips */}
                        <div>
                          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
                            Tool Access:
                          </span>
                          <TooltipProvider delayDuration={100}>
                            <div className="flex flex-wrap gap-1">
                              {skill.allowed_tools.map((t) => {
                                const meta = TOOL_METADATA[t];
                                return (
                                  <Tooltip key={t}>
                                    <TooltipTrigger asChild>
                                      <span
                                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/40 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground transition-colors cursor-help"
                                      >
                                        {t}
                                      </span>
                                    </TooltipTrigger>
                                    {meta && (
                                      <TooltipContent side="top" className="max-w-xs p-3 space-y-1 bg-card/95 border-border shadow-xl backdrop-blur-md">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-mono text-xs font-bold text-primary">{meta.label}</span>
                                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">{meta.service}</span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                          {meta.description}
                                        </p>
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </TooltipProvider>
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div className="pt-3 border-t border-border/40 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenEditModal(skill)}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Edit3 className="w-3 h-3 mr-1" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteSkill(skill.id, skill.name)}
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Delete
                          </Button>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTryInChat(`Trigger custom skill: ${skill.name}`)}
                          className="h-7 text-[11px] font-medium gap-1 text-primary border-primary/30 hover:bg-primary/10"
                        >
                          <PlayCircle className="w-3 h-3" /> Test
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 3: ENGINE ARCHITECTURE (INTERACTIVE FLOW DIAGRAM) */}
          <TabsContent value="architecture" className="space-y-6">
            <div className="rounded-2xl border border-border bg-card/60 p-6 sm:p-8 space-y-8">
              {/* Header */}
              <div className="pb-4 border-b border-border/60">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-primary" /> Orchestration Architecture Diagram
                </h3>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Interactive 5-stage pipeline showing how natural language queries travel through intent routing, persona injection, tool filtering, and safety screening:
                </p>
              </div>

              {/* Visual Pipeline Flow Chart */}
              <div className="relative">
                {/* Horizontal flow line for larger screens */}
                <div className="hidden lg:block absolute top-1/2 left-4 right-4 h-0.5 bg-gradient-to-r from-primary/20 via-primary/50 to-primary/20 -translate-y-1/2 z-0" />

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 relative z-10">
                  {[
                    {
                      step: 1,
                      name: "Intent Classifier",
                      model: "Claude Sonnet 5",
                      icon: Search,
                      color: "text-blue-400 bg-blue-500/10 border-blue-500/30",
                      badge: "Stage 1",
                      description: "Parses prompt & last 3 conversation turns. Classifies into 1 of 9 intents or matches custom keyword regex.",
                      output: "intent_category / custom_key",
                    },
                    {
                      step: 2,
                      name: "Skills Engine",
                      model: "Persona Injection",
                      icon: Wand2,
                      color: "text-primary bg-primary/10 border-primary/30",
                      badge: "Stage 2",
                      description: "Loads domain-specific priorities, CIS/MITRE schemas, and output format rules into system prompt.",
                      output: "systemSupplement + SSE Badge",
                    },
                    {
                      step: 3,
                      name: "Tool Mask Filter",
                      model: "Noise Reduction",
                      icon: Sliders,
                      color: "text-purple-400 bg-purple-500/10 border-purple-500/30",
                      badge: "Stage 3",
                      description: "Narrows active AWS tool definitions from 15 down to 3-4 specialized tools, cutting token overhead by ~80%.",
                      output: "Scoped Tool Definition Array",
                    },
                    {
                      step: 4,
                      name: "ReAct Agentic Loop",
                      model: "Sonnet 5 / Opus 5",
                      icon: Cpu,
                      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
                      badge: "Stage 4",
                      description: "Executes multi-pass reasoning loop, invoking live AWS SDK API endpoints with real cloud telemetry.",
                      output: "Proposed API Call Payloads",
                    },
                    {
                      step: 5,
                      name: "Safety Gate Judge",
                      model: "Double-Audited Pass",
                      icon: ShieldCheck,
                      color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
                      badge: "Stage 5",
                      description: "Independent secondary AI pass pre-screens every proposed mutation against destructive blocklists.",
                      output: "APPROVED / BLOCKED Verdict",
                    },
                  ].map((node) => {
                    const isSelected = activeDiagramStage === node.step;
                    const NodeIcon = node.icon;

                    return (
                      <div
                        key={node.step}
                        onClick={() => setActiveDiagramStage(node.step)}
                        className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between gap-3 bg-card/80 backdrop-blur-md shadow-sm hover:shadow-md ${
                          isSelected
                            ? "border-primary ring-2 ring-primary/20 scale-[1.02] bg-card"
                            : "border-border/70 hover:border-border"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${node.color}`}>
                              <NodeIcon className="w-4 h-4" />
                            </div>
                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40">
                              {node.badge}
                            </span>
                          </div>

                          <div>
                            <h4 className="text-xs font-bold text-foreground">{node.name}</h4>
                            <span className="text-[10px] font-mono text-primary/80">{node.model}</span>
                          </div>

                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {node.description}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-border/40">
                          <span className="text-[9px] font-mono text-muted-foreground/80 block uppercase tracking-wider">Output:</span>
                          <code className="text-[10px] font-mono text-foreground/90 truncate block mt-0.5">
                            {node.output}
                          </code>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stage Deep Dive Inspector */}
              <div className="p-5 rounded-2xl border border-primary/20 bg-background/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold font-mono text-primary flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Stage {activeDiagramStage} Technical Inspection
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Click any node in the diagram above to inspect
                  </span>
                </div>

                {activeDiagramStage === 1 && (
                  <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p className="text-foreground font-semibold">Stage 1: Intent Classification & Trigger Matching</p>
                    <p>
                      Before calling the main agentic loop, CloudPilot passes the user's latest query along with conversation context into a single-shot classifier running on <strong>Claude Sonnet 5</strong> (~100ms latency). If the query matches custom keyword regex from your custom skills, Tier 1 resolution executes immediately. Otherwise, it routes to one of the 9 built-in domains.
                    </p>
                  </div>
                )}

                {activeDiagramStage === 2 && (
                  <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p className="text-foreground font-semibold">Stage 2: Agent Skills Engine & Dynamic Persona Injection</p>
                    <p>
                      The classified intent or custom skill key triggers persona loading. The skill's <code>systemSupplement</code> is dynamically appended to Claude's system prompt with a <code>---</code> delimiter. An active skill badge (e.g. <code>Security Audit Specialist</code>) is simultaneously pushed to the UI via Server-Sent Events (SSE).
                    </p>
                  </div>
                )}

                {activeDiagramStage === 3 && (
                  <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p className="text-foreground font-semibold">Stage 3: Tool Definition Filtering</p>
                    <p>
                      Rather than exposing all 15 AWS tools (which consumes thousands of schema tokens per turn), the router maps the intent category to a pre-defined tool subset (<code>INTENT_TOOL_MAP</code>). For example, a cost query only receives 3 tools instead of 15, cutting token costs by ~80% and eliminating hallucinated tool choices.
                    </p>
                  </div>
                )}

                {activeDiagramStage === 4 && (
                  <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p className="text-foreground font-semibold">Stage 4: ReAct Agentic Loop & Live AWS Execution</p>
                    <p>
                      Claude executes a <strong>Reasoning and Acting (ReAct)</strong> loop (up to 15 iterations) with tool choice set to <code>required</code> on turn 1. It dynamically calls AWS STS, IAM, S3, EC2, CloudWatch, and Cost Explorer through the ephemeral Deno execution runtime.
                    </p>
                  </div>
                )}

                {activeDiagramStage === 5 && (
                  <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p className="text-foreground font-semibold">Stage 5: Dual-Model Safety Gate Interceptor</p>
                    <p>
                      Every proposed AWS SDK mutation is intercepted by an independent Safety Gate Judge pass before execution. The judge screens parameters against the hardcoded destructive operation blocklist (e.g. <code>deleteBucket</code>, <code>terminateInstances</code>, <code>closeAccount</code>) and validates privilege escalation patterns.
                    </p>
                  </div>
                )}
              </div>

              {/* Best Practices Info Box */}
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-2 text-xs text-muted-foreground">
                <span className="font-bold text-foreground flex items-center gap-1.5 text-xs text-primary">
                  <Info className="w-4 h-4" /> Best Practices for Custom Skill Directives:
                </span>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li><strong>Zero Simulation:</strong> Always instruct the persona to require real API call outputs and avoid simulated finding placeholders.</li>
                  <li><strong>Explicit Resource IDs:</strong> Direct the persona to quote exact ARNs, VPC IDs, and Security Group IDs.</li>
                  <li><strong>Structured Output:</strong> Mandate Markdown tables before narrative prose for scannable compliance summaries.</li>
                  <li><strong>Remediation CLI Commands:</strong> Instruct the persona to provide context-aware AWS CLI fix commands.</li>
                </ul>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Create / Edit Custom Skill Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              {editingSkillId ? "Edit Custom Skill Persona" : "Create Custom Specialist Skill"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a specialist persona with custom prompt directives, keyword triggers, and scoped AWS tools.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Skill Name *</label>
                <Input
                  placeholder="e.g. Kubernetes Cluster Hardener"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Display Badge *</label>
                <Input
                  placeholder="e.g. EKS Security Specialist"
                  value={formBadge}
                  onChange={(e) => setFormBadge(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Description</label>
              <Input
                placeholder="Brief summary of what this specialist focuses on..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="text-xs h-9"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Intent Key (Identifier)</label>
                <Input
                  placeholder="e.g. eks_hardener"
                  value={formIntentKey}
                  onChange={(e) => setFormIntentKey(e.target.value)}
                  className="text-xs h-9 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Trigger Keywords (Comma separated)</label>
                <Input
                  placeholder="e.g. eks, k8s, kubernetes, pod"
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>

            {/* Allowed Tools Checkboxes with Hover Tooltips */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground block">
                  Allowed AWS Security Tools ({formAllowedTools.length} selected):
                </label>
                <span className="text-[10px] font-mono text-muted-foreground">Hover over any tool for description</span>
              </div>
              <TooltipProvider delayDuration={100}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-2 rounded-xl border border-border/60 bg-muted/20">
                  {ALL_AVAILABLE_TOOLS.map((tool) => {
                    const checked = formAllowedTools.includes(tool);
                    const meta = TOOL_METADATA[tool];

                    return (
                      <Tooltip key={tool}>
                        <TooltipTrigger asChild>
                          <label
                            className={`flex items-center gap-1.5 text-[11px] font-mono p-1.5 rounded-lg border transition-all cursor-pointer ${
                              checked
                                ? "bg-primary/10 border-primary/40 text-foreground font-medium"
                                : "border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setFormAllowedTools((prev) =>
                                  checked ? prev.filter((t) => t !== tool) : [...prev, tool]
                                );
                              }}
                              className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 flex-shrink-0"
                            />
                            <span className="truncate">{tool}</span>
                          </label>
                        </TooltipTrigger>
                        {meta && (
                          <TooltipContent side="top" className="max-w-xs p-3 space-y-1 bg-card/95 border-border shadow-xl backdrop-blur-md">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-primary">{meta.label}</span>
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">{meta.service}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              {meta.description}
                            </p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </div>
              </TooltipProvider>
            </div>

            {/* System Supplement Prompt */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">
                  Persona System Supplement Directives *
                </label>
                <span className="text-[10px] font-mono text-muted-foreground">
                  Injected into Claude system context
                </span>
              </div>
              <textarea
                rows={6}
                value={formSystemSupplement}
                onChange={(e) => setFormSystemSupplement(e.target.value)}
                placeholder="ACTIVE SKILL: Your Skill Name&#10;You are operating as a specialized auditor...&#10;1. Priority one...&#10;2. Priority two..."
                className="w-full text-xs font-mono p-3 rounded-xl border border-border bg-background/80 focus:ring-1 focus:ring-primary focus:outline-none leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              disabled={isSaving}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveSkill}
              disabled={isSaving}
              className="text-xs h-8 bg-primary text-primary-foreground font-semibold"
            >
              {isSaving ? "Saving..." : editingSkillId ? "Update Skill" : "Create Skill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
