import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ChevronRight, Check, Play, Terminal, Shield, Cpu, RefreshCw, Database } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import CloudPilotLogo from "@/components/CloudPilotLogo";

// 3D Tilt interactive Glassmorphic Logo
const ThreeDLogo = () => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 20, y: -y * 20 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-40 h-40 mx-auto perspective-1000 group cursor-pointer"
    >
      <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-125 opacity-60 group-hover:opacity-90 transition-opacity duration-500 animate-pulse" />
      
      <div
        style={{
          transform: `rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
          transformStyle: "preserve-3d",
        }}
        className="w-full h-full relative transition-transform duration-200 ease-out flex items-center justify-center"
      >
        <div 
          style={{ transform: "translateZ(-30px)" }}
          className="absolute w-32 h-32 rounded-3xl bg-black/50 blur-lg" 
        />
        
        <div 
          style={{ transform: "translateZ(-15px)" }}
          className="absolute w-32 h-32 rounded-3xl bg-gradient-to-tr from-primary/20 to-blue-500/5 border border-primary/20 backdrop-blur-xl shadow-inner shadow-primary/10" 
        />
        
        <div 
          style={{ transform: "translateZ(10px)" }}
          className="absolute w-32 h-32 rounded-3xl bg-gradient-to-br from-[#0c1125] to-[#040815] border border-primary/45 flex items-center justify-center shadow-2xl shadow-primary/20"
        >
          <CloudPilotLogo className="w-16 h-16 text-primary filter drop-shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
        </div>
      </div>
    </div>
  );
};

// Animated Chat Console Showcase
const DEMO_CYCLES = [
  {
    query: "Scan S3 buckets for public access block gaps.",
    classification: "direct_query",
    terminalLogs: [
      "» INIT  Stateless exchange requested via ephemeral token...",
      "» CALL  s3:ListAllMyBuckets",
      "✔ RESP  Found 3 active S3 Buckets in default registry",
      "» CALL  s3:GetBucketPublicAccessBlock --bucket cp-prod-db-backups",
      "✔ RESP  BlockPublicAcls=true, BlockPublicPolicy=true",
      "» CALL  s3:GetBucketPublicAccessBlock --bucket cp-staging-assets",
      "⚠ RESP  BlockPublicPolicy=false -- Public configuration exposed!",
    ],
    agentResponse: `### S3 Public Access Scan Results

Audited **3 buckets** in your default account and detected **1 public exposure gap**:

| Bucket Name | Status | Recommendation | Risk Level |
| :--- | :--- | :--- | :--- |
| **cp-staging-assets** | **EXPOSED** | Restrict public bucket policy | **HIGH** |

**Auto-Fix Blueprint:**
\`\`\`bash
aws s3api put-public-access-block --bucket cp-staging-assets \\
  --public-access-block-configuration "BlockPublicPolicy=true"
\`\`\``
  },
  {
    query: "Audit my security groups for public SSH open ports.",
    classification: "ops_automation",
    terminalLogs: [
      "» INIT  Scanning EC2 infrastructure...",
      "» CALL  ec2:DescribeSecurityGroups",
      "✔ RESP  Loaded 8 active security groups",
      "» EVAL  Parsing ingress permission rules for 0.0.0.0/0 source...",
      "⚠ ALERT Port 22 (SSH) open to public on group sg-98cf11",
    ],
    agentResponse: `### Security Group Audit

I evaluated **8 security groups** and found **1 critical vulnerability**:

* **Default SG** (\`sg-98cf11\`):
  * **Issue**: Port **22** is open to all IPs (\`0.0.0.0/0\`).
  * **Risk**: High vulnerability to automated brute-force attacks.
  * **Command to run**:
  \`\`\`bash
  aws ec2 revoke-security-group-ingress --group-id sg-98cf11 --protocol tcp --port 22 --cidr 0.0.0.0/0
  \`\`\``
  }
];

const AnimatedConsole = () => {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [typedQuery, setTypedQuery] = useState("");
  const [phase, setPhase] = useState<"typing" | "routing" | "terminal" | "response">("typing");
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
  const [responseText, setResponseText] = useState("");

  const currentData = DEMO_CYCLES[cycleIndex];

  useEffect(() => {
    let active = true;

    if (phase === "typing") {
      let charIdx = 0;
      setTypedQuery("");
      setVisibleLogs([]);
      setResponseText("");
      
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
          }, 800);
        }
      }, 50);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }

    if (phase === "routing") {
      const timeout = setTimeout(() => {
        if (active) setPhase("terminal");
      }, 1000);
      return () => {
        active = false;
        clearTimeout(timeout);
      };
    }

    if (phase === "terminal") {
      let logIdx = 0;
      const interval = setInterval(() => {
        if (!active) return;
        if (logIdx < currentData.terminalLogs.length) {
          setVisibleLogs(prev => [...prev, currentData.terminalLogs[logIdx]]);
          logIdx++;
        } else {
          clearInterval(interval);
          setTimeout(() => {
            if (active) setPhase("response");
          }, 800);
        }
      }, 600);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }

    if (phase === "response") {
      let charIdx = 0;
      const text = currentData.agentResponse;
      const step = 4;
      
      const interval = setInterval(() => {
        if (!active) return;
        if (charIdx < text.length) {
          setResponseText(text.slice(0, charIdx + step));
          charIdx += step;
        } else {
          clearInterval(interval);
          setTimeout(() => {
            if (active) {
              setCycleIndex((prev) => (prev + 1) % DEMO_CYCLES.length);
              setPhase("typing");
            }
          }, 6000);
        }
      }, 15);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }
  }, [phase, cycleIndex]);

  return (
    <div className="w-full max-w-2xl mx-auto rounded-xl border border-border/50 bg-[#070b19]/80 shadow-2xl backdrop-blur-md overflow-hidden text-left font-mono text-xs text-muted-foreground flex flex-col h-[380px]">
      <div className="bg-[#0f1530] border-b border-border/40 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-semibold tracking-wider uppercase">
          <Terminal className="w-3.5 h-3.5 text-primary" />
          Interactive Live Agent Stream
        </div>
        <div className="w-8" />
      </div>

      <div className="flex-1 p-5 overflow-y-auto space-y-4 scrollbar-thin select-none">
        <div className="flex items-start gap-2.5">
          <span className="text-primary font-bold">user@cloudpilot:~$</span>
          <span className="text-foreground font-semibold leading-relaxed">
            {typedQuery}
            {phase === "typing" && <span className="animate-pulse bg-primary/70 text-primary w-1 h-3.5 ml-0.5 inline-block" />}
          </span>
        </div>

        {(phase === "routing" || phase === "terminal" || phase === "response") && (
          <div className="space-y-1 pl-4 border-l border-primary/20 py-1 bg-primary/5 rounded-r">
            <p className="text-[10px] text-primary/70 uppercase tracking-widest font-bold">⚡ Stateless Router</p>
            <p className="text-foreground/90">
              Router: Classified intent → <span className="text-blue-400 font-bold">{currentData.classification}</span>
            </p>
            <p className="text-muted-foreground">Loaded execution isolation workspace.</p>
          </div>
        )}

        {(phase === "terminal" || phase === "response") && (
          <div className="space-y-1.5 pl-4 border-l border-border/50 py-1">
            {visibleLogs.map((log, i) => (
              <p key={i} className={log.startsWith("✔") ? "text-green-400/90" : log.startsWith("⚠") ? "text-yellow-400" : "text-muted-foreground"}>
                {log}
              </p>
            ))}
            {phase === "terminal" && (
              <span className="animate-spin inline-block text-primary ml-1">
                <RefreshCw className="w-3 h-3" />
              </span>
            )}
          </div>
        )}

        {phase === "response" && (
          <div className="pl-4 border-l-2 border-green-500/40 py-2.5 bg-green-500/5 rounded-r text-foreground space-y-2 prose prose-invert max-w-none text-xs">
            <div className="flex items-center gap-1.5 text-green-400 font-bold uppercase text-[10px] tracking-wider">
              <Shield className="w-3.5 h-3.5" />
              Agent Findings
            </div>
            <div className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
              {responseText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Animated Flow Pipeline Component
const PipelineFlow = () => {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 5);
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
        <span className="text-[10px] font-mono tracking-widest text-primary uppercase font-bold px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">Execution Architecture</span>
        <h3 className="text-xl font-semibold text-white mt-3">Stateless Security Transaction Flow</h3>
      </div>

      <div className="relative flex flex-col lg:flex-row items-center justify-between gap-12 max-w-5xl mx-auto">
        {flowSteps.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === activeStep;
          return (
            <div key={idx} className="flex-1 flex flex-col items-center text-center relative z-10 w-full">
              {/* Animated ring glow wrapper */}
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

              {/* Connecting Pipeline arrow channel */}
              {idx < 4 && (
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
        staggerChildren: 0.15
      }
    }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 20 },
    show: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } 
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-[#f5f5f7] font-sans overflow-x-hidden selection:bg-primary/20 selection:text-primary relative">
      {/* Ambient Radial Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.03)_0%,transparent_70%)] pointer-events-none z-0" />

      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/10 bg-[#030712]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center glow-primary">
              <span className="text-primary font-bold text-sm">CP</span>
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

      {/* Hero Split Layout */}
      <section className="relative pt-24 pb-12 md:pt-36 md:pb-20 max-w-6xl mx-auto px-6 z-10">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Text Column */}
          <motion.div 
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="lg:col-span-6 space-y-6 text-center lg:text-left"
          >
            <motion.div 
              variants={fadeUp}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-mono tracking-wider uppercase font-semibold"
            >
              <Cpu className="w-3.5 h-3.5" />
              100% Stateless Security Engine
            </motion.div>

            <motion.h1 
              variants={fadeUp}
              className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08] text-white"
            >
              AWS Security Agent.<br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">Stateless Accuracy.</span>
            </motion.h1>

            <motion.p 
              variants={fadeUp}
              className="text-[#86868b] text-sm md:text-base max-w-lg mx-auto lg:mx-0 font-normal leading-relaxed"
            >
              Audit configurations, evaluate security group exposures, map attack movement, and execute sandbox scans without persistent key storage.
            </motion.p>

            <motion.div 
              variants={fadeUp}
              className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-2"
            >
              <Button
                onClick={handleLaunch}
                className="bg-[#f5f5f7] text-background hover:bg-[#e8e8ed] rounded-full px-7 py-5 font-semibold text-xs tracking-tight transition-colors flex items-center gap-2 group w-full sm:w-auto"
              >
                Launch Free Console
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              
              <a
                href="#demo"
                className="text-[#86868b] hover:text-[#f5f5f7] transition-colors flex items-center gap-1.5 text-xs font-semibold py-2"
              >
                <Play className="w-3 h-3 text-primary fill-primary/10" />
                Watch active simulation
              </a>
            </motion.div>

            {/* Render 3D Logo floating beneath */}
            <motion.div variants={fadeUp} className="pt-6 hidden lg:block">
              <ThreeDLogo />
            </motion.div>
          </motion.div>

          {/* Right Interactive Console Column */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="lg:col-span-6 w-full" 
            id="demo"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full scale-105 pointer-events-none" />
              <AnimatedConsole />
            </div>
          </motion.div>
        </div>
      </section>

      {/* 3D Logo For Mobile / Tablet */}
      <div className="lg:hidden py-6">
        <ThreeDLogo />
      </div>

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

      {/* Security Architecture */}
      <section id="security" className="py-20 border-t border-border/10 bg-[#040816]/50 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            <motion.div 
              initial={{ opacity: 0, x: -15 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="lg:col-span-7 space-y-6"
            >
              <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-white leading-tight">
                Stateless isolation.<br />
                Your credentials stay yours.
              </h2>
              <p className="text-[#86868b] text-sm leading-relaxed">
                CloudPilot exchanges temporary AWS Security Token Service (STS) credentials inside local sandbox environments. Your raw secret keys reside exclusively in the client's secure local context.
              </p>
              <div className="space-y-3 pt-2">
                {[
                  "Stateless memory isolation (no persistent key databases)",
                  "Short-lived session limits matching standard security principles",
                  "Fully verified and compliant WORM logs",
                  "Integrated pre-flight blocklists preventing toxic actions"
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs text-[#86868b]">
                    <Check className="w-4 h-4 text-primary shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <Link
                  to="/security"
                  className="text-primary hover:text-primary/80 text-xs font-semibold inline-flex items-center gap-0.5"
                >
                  Verify our full security architecture <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, x: 15 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="lg:col-span-5 border border-border/10 rounded-xl bg-[#090d1a] p-6 space-y-4"
            >
              <h3 className="text-sm font-semibold text-white">Trust & Isolation Principles</h3>
              <p className="text-xs text-[#86868b] leading-relaxed">
                CloudPilot has been built from the ground up for maximum separation of duties. Our servers never store persistent administrative credentials. All auditing operations run as client-initiated sandbox transactions.
              </p>
              <div className="p-3.5 rounded-lg bg-[#0d142b]/60 border border-primary/20 text-[10px] font-mono text-primary leading-relaxed">
                🔒 Security Checkpoint: Local isolation verified. Local Ollama integration isolates all security scanning operations within your local network sandbox boundary.
              </div>
            </motion.div>
          </div>
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
