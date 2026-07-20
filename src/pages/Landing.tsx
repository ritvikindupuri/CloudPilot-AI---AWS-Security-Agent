import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ChevronRight, Check, Shield, Cpu, RefreshCw, Database, Terminal, User, Loader2, Send, MessageSquare, Gavel } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import ThinkingIndicator from "@/components/ThinkingIndicator";

// 3D Tilt interactive Glassmorphic Logo
const ThreeDLogo = () => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 15, y: -y * 15 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-36 h-36 mx-auto perspective-1000 group cursor-pointer"
    >
      {/* Glow Backdrop */}
      <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-125 opacity-60 group-hover:opacity-90 transition-opacity duration-500 animate-pulse" />
      
      {/* 3D Container */}
      <div
        style={{
          transform: `rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
          transformStyle: "preserve-3d",
        }}
        className="w-full h-full relative transition-transform duration-200 ease-out flex items-center justify-center"
      >
        {/* Shadow layer */}
        <div 
          style={{ transform: "translateZ(-25px)" }}
          className="absolute w-28 h-28 rounded-3xl bg-black/50 blur-lg" 
        />
        
        {/* Layer 1: Glass border */}
        <div 
          style={{ transform: "translateZ(-10px)" }}
          className="absolute w-28 h-28 rounded-3xl bg-gradient-to-tr from-primary/25 to-blue-500/5 border border-primary/20 backdrop-blur-xl shadow-inner shadow-primary/10" 
        />
        
        {/* Layer 2: Core Logo Container */}
        <div 
          style={{ transform: "translateZ(10px)" }}
          className="absolute w-28 h-28 rounded-3xl bg-gradient-to-br from-[#0c1125] to-[#040815] border border-primary/45 flex items-center justify-center shadow-2xl shadow-primary/25"
        >
          <CloudPilotLogo className="w-14 h-14 text-primary filter drop-shadow-[0_0_12px_rgba(59,130,246,0.55)]" />
        </div>
      </div>
    </div>
  );
};

// Animated Chat Console Showcase
const DEMO_CYCLES = [
  {
    query: "Scan S3 buckets for public access block gaps.",
    thinkingLogs: [
      { step: "Router", status: "info" as const, message: "Classifying query intent..." },
      { step: "Router", status: "success" as const, message: "Activated 8 security tools for intent: **direct_query**" },
      { step: "Safety Gate", status: "info" as const, message: "Auditing proposed AWS SDK calls..." },
      { step: "Safety Gate", status: "success" as const, message: "Safety Gate Judge: **APPROVED**. Reason: Query is read-only S3 configuration audit." },
      { step: "Execution", status: "info" as const, message: "Executing AWS SDK calls on account (`s3:ListAllMyBuckets`, `s3:GetBucketPublicAccessBlock`)..." },
      { step: "Execution", status: "success" as const, message: "AWS API batch successfully executed (3 buckets retrieved)." },
      { step: "Agent", status: "success" as const, message: "Generating final security analysis report and streaming results..." },
    ],
    renderResponse: () => (
      <div className="space-y-3 font-sans text-xs">
        <h3 className="text-sm font-semibold text-white border-b border-border/20 pb-1.5 mt-2">S3 Public Access Scan Results</h3>
        <p className="text-muted-foreground">Audited <strong className="text-foreground">3 buckets</strong> in your default account and detected <strong className="text-foreground">1 public exposure gap</strong>:</p>
        
        <div className="overflow-hidden border border-border/30 rounded-lg bg-[#070b19]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#1b2244]/50 border-b border-border/30 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                <th className="px-3 py-2">Bucket Name</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Recommendation</th>
                <th className="px-3 py-2 text-right">Risk</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-foreground border-b border-border/20 text-[11px]">
                <td className="px-3 py-2 font-medium">cp-staging-assets</td>
                <td className="px-3 py-2 text-rose-400 font-bold">EXPOSED</td>
                <td className="px-3 py-2 text-muted-foreground">Restrict public policy</td>
                <td className="px-3 py-2 text-right"><span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 px-1.5 py-0.5 rounded text-[9px] font-bold">HIGH</span></td>
              </tr>
              <tr className="text-muted-foreground/80 text-[11px] bg-[#1b2244]/10">
                <td className="px-3 py-2">cp-prod-db-backups</td>
                <td className="px-3 py-2 text-emerald-400 font-semibold">SECURE</td>
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="font-semibold text-foreground mt-3">Auto-Fix Blueprint:</p>
        <pre className="bg-[#090d20] border border-border/40 rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto">
{`aws s3api put-public-access-block --bucket cp-staging-assets \\
  --public-access-block-configuration "BlockPublicPolicy=true"`}
        </pre>
      </div>
    )
  },
  {
    query: "Audit my security groups for public SSH open ports.",
    thinkingLogs: [
      { step: "Router", status: "info" as const, message: "Classifying query intent..." },
      { step: "Router", status: "success" as const, message: "Activated 6 security tools for intent: **ops_automation**" },
      { step: "Safety Gate", status: "info" as const, message: "Auditing proposed AWS SDK calls..." },
      { step: "Safety Gate", status: "success" as const, message: "Safety Gate Judge: **APPROVED**. Reason: Read-only EC2 security group rule inspection." },
      { step: "Execution", status: "info" as const, message: "Executing AWS SDK calls on account (`ec2:DescribeSecurityGroups`)..." },
      { step: "Execution", status: "success" as const, message: "AWS API batch successfully executed (8 security groups evaluated)." },
      { step: "Agent", status: "success" as const, message: "Generating final security analysis report and streaming results..." },
    ],
    renderResponse: () => (
      <div className="space-y-3 font-sans text-xs">
        <h3 className="text-sm font-semibold text-white border-b border-border/20 pb-1.5 mt-2">Security Group Audit</h3>
        <p className="text-muted-foreground">I evaluated <strong className="text-foreground">8 security groups</strong> and found <strong className="text-foreground">1 critical vulnerability</strong>:</p>
        
        <div className="p-3.5 rounded-lg bg-[#1b2244]/20 border border-border/40 space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-foreground">Default SG (sg-98cf11)</span>
            <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 px-1.5 py-0.5 rounded text-[9px] font-bold">HIGH RISK</span>
          </div>
          <ul className="space-y-1 pl-4 list-disc text-muted-foreground">
            <li><strong className="text-foreground">Issue:</strong> Port 22 (SSH) is open to all IPs (0.0.0.0/0).</li>
            <li><strong className="text-foreground">Risk:</strong> High vulnerability to automated brute-force attacks.</li>
          </ul>
        </div>

        <p className="font-semibold text-foreground mt-3">Remediation Command:</p>
        <pre className="bg-[#090d20] border border-border/40 rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto">
{`aws ec2 revoke-security-group-ingress --group-id sg-98cf11 \\
  --protocol tcp --port 22 --cidr 0.0.0.0/0`}
        </pre>
      </div>
    )
  },
  {
    query: "Audit IAM for privilege escalation risks.",
    thinkingLogs: [
      { step: "Router", status: "info" as const, message: "Classifying query intent..." },
      { step: "Router", status: "success" as const, message: "Activated 12 security tools for intent: **attack_simulation**" },
      { step: "Safety Gate", status: "info" as const, message: "Auditing proposed IAM escalation policies..." },
      { step: "Safety Gate", status: "success" as const, message: "Safety Gate Judge: **APPROVED**. Reason: Read-only privilege escalation scan." },
      { step: "Execution", status: "info" as const, message: "Executing AWS API calls (`iam:GetAccountAuthorizationDetails`)..." },
      { step: "Execution", status: "success" as const, message: "AWS API batch successfully executed (1 escalation path detected)." },
      { step: "Agent", status: "success" as const, message: "Generating final security analysis report and streaming results..." },
    ],
    renderResponse: () => (
      <div className="space-y-3 font-sans text-xs">
        <h3 className="text-sm font-semibold text-white border-b border-border/20 pb-1.5 mt-2">IAM Privilege Escalation Assessment</h3>
        <p className="text-muted-foreground">Evaluated IAM identities and discovered <strong className="text-foreground">1 critical escalation path</strong>:</p>
        
        <div className="p-3.5 rounded-lg bg-[#1b2244]/20 border border-border/40 space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-foreground">User: dev-deployer</span>
            <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 px-1.5 py-0.5 rounded text-[9px] font-bold">CRITICAL</span>
          </div>
          <ul className="space-y-1 pl-4 list-disc text-muted-foreground">
            <li><strong className="text-foreground">Path:</strong> Granted <code className="bg-[#090d20] text-amber-300 px-1 py-0.5 rounded">iam:CreatePolicyVersion</code> permission.</li>
            <li><strong className="text-foreground">Impact:</strong> Principal can attach an unrestricted policy version to gain AdministratorAccess.</li>
          </ul>
        </div>

        <p className="font-semibold text-foreground mt-3">Remediation Blueprint:</p>
        <pre className="bg-[#090d20] border border-border/40 rounded-lg p-3 text-[11px] font-mono text-foreground overflow-x-auto">
{`aws iam delete-policy-version --policy-arn arn:aws:iam::123456789012:policy/DevDeployPolicy \\
  --version-id v2`}
        </pre>
      </div>
    )
  }
];

const AnimatedConsole = () => {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [typedQuery, setTypedQuery] = useState("");
  const [phase, setPhase] = useState<"typing" | "routing" | "terminal" | "response">("typing");
  const [visibleThinkingLogs, setVisibleThinkingLogs] = useState<Array<{ step: string; status: "info" | "success" | "warning" | "error"; message: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [typedQuery, visibleThinkingLogs, phase]);

  const currentData = DEMO_CYCLES[cycleIndex];

  useEffect(() => {
    let active = true;

    if (phase === "typing") {
      let charIdx = 0;
      setTypedQuery("");
      setVisibleThinkingLogs([]);
      
      const interval = setInterval(() => {
        if (!active) return;
        const targetQuery = currentData.query;
        if (charIdx < targetQuery.length) {
          setTypedQuery(targetQuery.slice(0, charIdx + 1));
          charIdx++;
        } else {
          clearInterval(interval);
          setTimeout(() => {
            if (active) setPhase("routing");
          }, 600);
        }
      }, 50);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }

    if (phase === "routing") {
      setVisibleThinkingLogs(currentData.thinkingLogs.slice(0, 2));
      const timeout = setTimeout(() => {
        if (active) setPhase("terminal");
      }, 900);
      return () => {
        active = false;
        clearTimeout(timeout);
      };
    }

    if (phase === "terminal") {
      let count = 2;
      const interval = setInterval(() => {
        if (!active) return;
        count++;
        setVisibleThinkingLogs(currentData.thinkingLogs.slice(0, count));
        if (count >= currentData.thinkingLogs.length) {
          clearInterval(interval);
          setTimeout(() => {
            if (active) setPhase("response");
          }, 700);
        }
      }, 450);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }

    if (phase === "response") {
      const timeout = setTimeout(() => {
        if (active) {
          setCycleIndex((prev) => (prev + 1) % DEMO_CYCLES.length);
          setPhase("typing");
        }
      }, 8000);

      return () => {
        active = false;
        clearTimeout(timeout);
      };
    }
  }, [phase, cycleIndex]);

  return (
    <div className="w-full max-w-2xl mx-auto rounded-xl border border-border/50 bg-[#080c1d]/90 shadow-2xl backdrop-blur-md overflow-hidden text-left flex flex-col h-[460px]">
      {/* Header */}
      <div className="bg-[#0f1430] border-b border-border/40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <CloudPilotLogo className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold text-white tracking-wide">CloudPilot Assistant</span>
          <span className="flex h-1.5 w-1.5 relative ml-1">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
        </div>
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 p-5 overflow-y-auto space-y-4 scrollbar-thin bg-gradient-to-b from-[#090d20] to-[#040715] flex flex-col">
        <div className="space-y-4">
          {/* User Message Bubble */}
          {(phase === "typing" || phase === "routing" || phase === "terminal" || phase === "response") && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex gap-3 justify-end items-start"
            >
              <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed bg-[#1b2244] border border-border/60 max-w-[80%] text-foreground font-sans">
                {typedQuery}
                {phase === "typing" && <span className="animate-pulse bg-primary/70 text-primary w-1 h-3.5 ml-0.5 inline-block" />}
              </div>
              <div className="flex-shrink-0">
                <div className="w-7 h-7 rounded-lg bg-[#1b2244] border border-border/40 flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            </motion.div>
          )}

          {/* ThinkingIndicator showing Intent Router & Safety Gate Judge Steps */}
          {(phase === "routing" || phase === "terminal") && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="-ml-5 -mr-5 -my-2"
            >
              <ThinkingIndicator logs={visibleThinkingLogs} />
            </motion.div>
          )}

          {/* Assistant Response Bubble */}
          {phase === "response" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex gap-3 items-start"
            >
              <div className="flex-shrink-0">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
                  <CloudPilotLogo className="w-4 h-4 text-primary" />
                </div>
              </div>
              <div className="flex-1 min-w-0 bg-[#0f142c] border border-[#1b2244] rounded-xl px-4 py-3.5 text-[13px] leading-relaxed text-foreground font-sans">
                {currentData.renderResponse()}
                
                {/* Under the hood transaction confirmation badge */}
                <div className="mt-3 pt-2.5 border-t border-[#1b2244] flex flex-wrap gap-2 text-[10px] font-mono text-muted-foreground/60">
                  <span className="bg-[#1b2244] px-1.5 py-0.5 rounded border border-border/40 text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="w-2.5 h-2.5" /> Stateless Scan Done
                  </span>
                  <span className="bg-[#1b2244] px-1.5 py-0.5 rounded border border-border/40">100% Offline</span>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Input Box Mock */}
      <div className="bg-[#0f1430] border-t border-border/40 p-3 flex items-center gap-2">
        <div className="flex-1 bg-[#090d20] border border-border/60 rounded-lg px-3 py-2 text-[12px] text-muted-foreground/50 select-none font-sans">
          {phase === "typing" ? "User is typing..." : "Ask about your AWS environment..."}
        </div>
        <Button variant="terminal" size="icon" className="h-8 w-8 flex-shrink-0 rounded-md bg-[#1b2244] hover:bg-[#232b55] text-primary" disabled>
          <Send className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
};

// Animated Flow Pipeline Component
const PipelineFlow = () => {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 6);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const flowSteps = [
    {
      title: "Query & Keys",
      desc: "Client initiates query & signs keys locally.",
      icon: Terminal,
    },
    {
      title: "Stateless Router",
      desc: "Classifies intent to minimize permission footprint.",
      icon: Cpu,
    },
    {
      title: "STS Token Exchange",
      desc: "STS issues temporary 1-hour session credentials.",
      icon: Shield,
    },
    {
      title: "Safety Gate Judge",
      desc: "Audits proposed AWS commands against security policies.",
      icon: Gavel,
    },
    {
      title: "Sandbox Run",
      desc: "Executes AWS APIs in serverless isolation.",
      icon: RefreshCw,
    },
    {
      title: "WORM Compliance",
      desc: "Immutable activity logs committed to S3.",
      icon: Database,
    }
  ];

  return (
    <div className="w-full py-16 px-6 border border-border/10 rounded-2xl bg-[#070b1a]/40 backdrop-blur-md relative overflow-hidden select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.03)_0%,transparent_70%)] pointer-events-none" />
      
      <div className="text-center mb-12">
        <h3 className="text-xl font-semibold text-white">Stateless Security Transaction Flow</h3>
      </div>

      <div className="relative flex flex-col lg:flex-row items-center justify-between gap-12 max-w-5xl mx-auto">
        {flowSteps.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === activeStep;
          return (
            <div key={idx} className="flex-1 flex flex-col items-center text-center relative z-10 w-full">
              <div className="relative">
                {isActive && (
                  <span className="absolute -inset-2.5 rounded-full bg-primary/25 blur-sm animate-ping" />
                )}
                <div className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all duration-500 relative z-10 ${
                  isActive 
                    ? "bg-primary/20 border-primary shadow-[0_0_20px_rgba(59,130,246,0.4)] text-primary scale-110" 
                    : "bg-[#0c1228] border-border/40 text-muted-foreground"
                }`}>
                  <Icon className="w-6 h-6" />
                </div>
              </div>

              <h4 className={`text-xs font-semibold mt-4 transition-colors duration-300 ${isActive ? "text-primary" : "text-white"}`}>
                {step.title}
              </h4>
              <p className="text-[11px] text-muted-foreground mt-1.5 max-w-[170px] leading-relaxed">
                {step.desc}
              </p>

              {idx < 5 && (
                <div className="hidden lg:block absolute top-7 left-[calc(50%+2rem)] right-[calc(-50%+2rem)] h-[3px] bg-border/20 overflow-hidden">
                  <div className={`h-full bg-gradient-to-r from-transparent via-primary to-transparent w-16 transition-transform duration-1000 ${
                    isActive ? "animate-flow-arrow" : "hidden"
                  }`} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Landing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLaunch = () => {
    if (user) {
      navigate("/app");
    } else {
      navigate("/auth");
    }
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12
      }
    }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 15 },
    show: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } 
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-[#f5f5f7] font-sans overflow-x-hidden selection:bg-primary/20 selection:text-primary relative">
      {/* Ambient Radial Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.03)_0%,transparent_70%)] pointer-events-none z-0" />

      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/10 bg-[#030712]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center glow-primary">
              <CloudPilotLogo className="w-4.5 h-4.5 text-primary" />
            </div>
            <span className="font-semibold text-xs tracking-tight text-[#f5f5f7]">CloudPilot AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-[11px] font-normal text-[#86868b]">
            <a href="#features" className="hover:text-[#f5f5f7] transition-colors">Capabilities</a>
            <a href="#flow" className="hover:text-[#f5f5f7] transition-colors">How it works</a>
            <a href="#security" className="hover:text-[#f5f5f7] transition-colors">Security</a>
            <Link to="/security" className="text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5">
              Security Center <ChevronRight className="w-2.5 h-2.5" />
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            {user ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/app")}
                className="text-[11px] h-8 px-4 bg-muted hover:bg-muted/80 text-[#f5f5f7] rounded-full transition-colors font-normal"
              >
                Go to App
              </Button>
            ) : (
              <>
                <Link to="/auth" className="text-[11px] text-[#86868b] hover:text-[#f5f5f7] transition-colors">Sign In</Link>
                <Button
                  size="sm"
                  onClick={() => navigate("/auth")}
                  className="text-[11px] h-8 px-4 bg-[#f5f5f7] text-background hover:bg-[#e8e8ed] rounded-full transition-colors font-semibold"
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section (Centered Layout matching Claude/ChatGPT) */}
      <section className="relative pt-24 pb-12 md:pt-36 md:pb-16 max-w-4xl mx-auto px-6 z-10 text-center">
        <motion.div 
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="space-y-6"
        >
          {/* Centered 3D Tilt interactive Logo */}
          <motion.div variants={fadeUp} className="mb-2">
            <ThreeDLogo />
          </motion.div>



          {/* Centered Main Headline */}
          <motion.h1 
            variants={fadeUp}
            className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08] text-white"
          >
            AWS Security Agent.<br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">Stateless Accuracy.</span>
          </motion.h1>

          {/* Centered Shortened Copy */}
          <motion.p 
            variants={fadeUp}
            className="text-[#86868b] text-sm md:text-base max-w-xl mx-auto font-normal leading-relaxed"
          >
            Audit configurations, scan security group exposures, and map lateral movement without storing persistent credentials.
          </motion.p>

          {/* Centered Call-To-Action Button */}
          <motion.div 
            variants={fadeUp}
            className="flex items-center justify-center pt-2"
          >
            <Button
              onClick={handleLaunch}
              className="bg-[#f5f5f7] text-background hover:bg-[#e8e8ed] rounded-full px-8 py-5 font-semibold text-xs tracking-tight transition-colors flex items-center gap-2 group w-full sm:w-auto"
            >
              Launch Console
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </motion.div>

          {/* Anthropic Cyber Verification Program Badge */}
          <motion.div 
            variants={fadeUp}
            className="pt-3 flex justify-center"
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[11px] font-mono shadow-lg shadow-emerald-500/5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Anthropic Cyber Verification Program Approved (Org ID: 38788112-a992-4ebe-a040-de2590eb13bf)</span>
            </div>
          </motion.div>
        </motion.div>

        {/* Centered Animated Interactive Chat Console directly below CTAs */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-14 w-full max-w-3xl mx-auto relative" 
          id="demo"
        >
          <div className="absolute inset-0 bg-primary/5 blur-3xl rounded-full scale-105 pointer-events-none" />
          <AnimatedConsole />
        </motion.div>
      </section>

      {/* Animated Pipeline Flow Diagram Section */}
      <section id="flow" className="py-20 border-t border-border/10 bg-[#040816]/30 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <PipelineFlow />
          </motion.div>
        </div>
      </section>

      {/* Capabilities Feature Grid */}
      <section id="features" className="py-20 border-t border-border/10 bg-[#030712] relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl mb-12 text-center lg:text-left"
          >
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#f5f5f7]">Engineered for cloud experts.</h2>
            <p className="text-[#86868b] text-xs font-normal mt-2 leading-relaxed">
              Every vulnerability scan, access analysis, and posture check triggers live AWS SDK calls. Zero mocked findings.
            </p>
          </motion.div>

          <motion.div 
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {[
              {
                icon: Shield,
                title: "Zero Simulation",
                desc: "Assessments map directly to real-time AWS API responses. No simulated states or placeholder reports."
              },
              {
                icon: Cpu,
                title: "Smart Intent Routing",
                desc: "Classifies natural user prompts, loading only the exact AWS API tools required to limit token footprints."
              },
              {
                icon: RefreshCw,
                title: "Stateless Execution",
                desc: "Short-lived session keys live strictly in transient client memory, completely bypassing persistent database storage."
              },
              {
                icon: Database,
                title: "WORM Compliance Logs",
                desc: "Activity transactions are archived and locked inside secure, tamper-proof S3 buckets to fulfill compliance mandates."
              }
            ].map((feat, i) => (
              <motion.div 
                key={i} 
                variants={fadeUp}
                className="border border-border/10 rounded-xl bg-[#090d1a]/50 p-5 hover:border-primary/20 transition-all group duration-300"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <feat.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{feat.title}</h3>
                <p className="text-[#86868b] text-xs font-normal leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* One-Click Quick Actions Showcase */}
      <section className="py-20 border-t border-border/10 bg-[#040816]/30 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="max-w-2xl mb-12 text-center lg:text-left"
          >
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#f5f5f7]">25+ One-Click Security Playbooks</h2>
            <p className="text-[#86868b] text-xs font-normal mt-2 leading-relaxed">
              No prompt engineering required. Launch specialized AWS security audits, compliance evaluations, and red-teaming simulations with a single click.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                category: "AUDIT WORKFLOWS",
                color: "text-blue-400 border-blue-500/20 bg-blue-500/5",
                items: ["S3 Public Access Scan", "Unified Account Audit", "IAM Posture Analysis", "EC2 Security Group Exposure", "RDS & Aurora Security", "Cost Anomaly Detection", "Overnight Drift Digest"]
              },
              {
                category: "COMPLIANCE STANDARDS",
                color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
                items: ["CIS AWS Benchmark v3.0", "CloudTrail Multi-Region Check", "GuardDuty Detector Status", "Security Hub Standard Audit", "NIST & PCI-DSS Scans"]
              },
              {
                category: "ATTACK SIMULATIONS",
                color: "text-rose-400 border-rose-500/20 bg-rose-500/5",
                items: ["IAM Privilege Escalation", "Secrets Exposure Assessment", "S3 Exfiltration Paths", "Lateral Movement Mapping", "AI vs AI Attack Simulation", "Threat Detector Anomaly Audit"]
              }
            ].map((col, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                className="border border-border/10 rounded-xl bg-[#090d1a]/50 p-6 flex flex-col justify-between"
              >
                <div>
                  <div className={`inline-block text-[10px] font-mono font-bold tracking-widest px-2.5 py-1 rounded border mb-4 ${col.color}`}>
                    {col.category}
                  </div>
                  <ul className="space-y-2.5">
                    {col.items.map((item, itemIdx) => (
                      <li key={itemIdx} className="flex items-center gap-2.5 text-xs text-muted-foreground font-sans">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Security Architecture */}
      <section id="security" className="py-20 border-t border-border/10 bg-[#040816]/50 relative z-10">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-white leading-tight">
              Stateless isolation.<br />
              Your credentials stay yours.
            </h2>
            <p className="text-[#86868b] text-sm leading-relaxed max-w-2xl mx-auto">
              CloudPilot exchanges temporary AWS Security Token Service (STS) credentials inside local sandbox environments. Your raw secret keys reside exclusively in the client's secure local context.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto pt-4 text-left">
              {[
                "Stateless memory isolation (no persistent key databases)",
                "Short-lived session limits matching standard security principles",
                "Fully verified and compliant WORM logs",
                "Integrated pre-flight blocklists preventing toxic actions"
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-xs text-[#86868b] border border-border/10 rounded-lg bg-[#090d1a] p-3">
                  <Check className="w-4 h-4 text-primary shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className="pt-4">
              <Link
                to="/security"
                className="text-primary hover:text-primary/80 text-xs font-semibold inline-flex items-center gap-0.5"
              >
                Verify our full security architecture <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/10 bg-[#030712] py-8 text-center text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 CloudPilot AI. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <Link to="/security" className="hover:text-foreground transition-colors">Security</Link>
            <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
