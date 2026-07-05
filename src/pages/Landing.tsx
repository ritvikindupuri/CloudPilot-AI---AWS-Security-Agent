import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowRight, ChevronRight, Check, Play, Terminal, Shield, Cpu, RefreshCw, Database } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

// 3D Tilt interactive Glassmorphic Logo
const ThreeDLogo = () => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5
    setTilt({ x: x * 20, y: -y * 20 }); // Scale to max 20 degrees
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-44 h-44 mx-auto perspective-1000 group cursor-pointer"
    >
      {/* Dynamic Background Glow */}
      <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-125 opacity-60 group-hover:opacity-90 transition-opacity duration-500 animate-pulse" />
      
      {/* 3D Rotatable Wrapper */}
      <div
        style={{
          transform: `rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
          transformStyle: "preserve-3d",
        }}
        className="w-full h-full relative transition-transform duration-200 ease-out flex items-center justify-center"
      >
        {/* Shadow Layer */}
        <div 
          style={{ transform: "translateZ(-30px)" }}
          className="absolute w-36 h-36 rounded-3xl bg-black/50 blur-lg" 
        />
        
        {/* Layer 1: Semi-transparent Border Glass */}
        <div 
          style={{ transform: "translateZ(-15px)" }}
          className="absolute w-36 h-36 rounded-3xl bg-gradient-to-tr from-primary/20 to-blue-500/5 border border-primary/20 backdrop-blur-xl shadow-inner shadow-primary/10" 
        />
        
        {/* Layer 2: Main metallic dark face */}
        <div 
          style={{ transform: "translateZ(10px)" }}
          className="absolute w-36 h-36 rounded-3xl bg-gradient-to-br from-[#0c1125] to-[#040815] border border-primary/45 flex items-center justify-center shadow-2xl shadow-primary/20"
        >
          <svg 
            className="w-18 h-18 text-primary filter drop-shadow-[0_0_12px_rgba(59,130,246,0.5)]" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="1.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-.778.099-1.533.284-2.253" />
          </svg>
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
      const step = 4; // print 4 chars at a time for speed
      
      const interval = setInterval(() => {
        if (!active) return;
        if (charIdx < text.length) {
          setResponseText(text.slice(0, charIdx + step));
          charIdx += step;
        } else {
          clearInterval(interval);
          // Wait 6 seconds, then move to next cycle
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
      {/* Header Bar */}
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

      {/* Console Area */}
      <div className="flex-1 p-5 overflow-y-auto space-y-4 scrollbar-thin select-none">
        {/* User Prompt */}
        <div className="flex items-start gap-2.5">
          <span className="text-primary font-bold">user@cloudpilot:~$</span>
          <span className="text-foreground font-semibold leading-relaxed">
            {typedQuery}
            {phase === "typing" && <span className="animate-pulse bg-primary/70 text-primary w-1 h-3.5 ml-0.5 inline-block" />}
          </span>
        </div>

        {/* Intent Routing Step */}
        {(phase === "routing" || phase === "terminal" || phase === "response") && (
          <div className="space-y-1 pl-4 border-l border-primary/20 py-1 bg-primary/5 rounded-r">
            <p className="text-[10px] text-primary/70 uppercase tracking-widest font-bold">⚡ Stateless Router</p>
            <p className="text-foreground/90">
              Router: Classified intent → <span className="text-blue-400 font-bold">{currentData.classification}</span>
            </p>
            <p className="text-muted-foreground">Loaded execution isolation workspace.</p>
          </div>
        )}

        {/* Terminal Logs Step */}
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

        {/* Final Agent Response Step */}
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

  return (
    <div className="min-h-screen bg-[#030712] text-[#f5f5f7] font-sans overflow-x-hidden selection:bg-primary/20 selection:text-primary relative">
      {/* Ambient Grid Backdrop */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#111625_1px,transparent_1px),linear-gradient(to_bottom,#111625_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-40" />

      {/* Floating Header */}
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
            <a href="#demo" className="hover:text-[#f5f5f7] transition-colors">Live Simulation</a>
            <a href="#security" className="hover:text-[#f5f5f7] transition-colors">Security Design</a>
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
      <section className="relative pt-28 pb-16 md:pt-40 md:pb-24 max-w-6xl mx-auto px-6 z-10">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Text Column */}
          <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-mono tracking-wider uppercase font-semibold">
              <Cpu className="w-3.5 h-3.5" />
              100% Stateless Security Engine
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.08] text-white">
              AWS Security Agent.<br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">Stateless Accuracy.</span>
            </h1>

            <p className="text-[#86868b] text-sm md:text-base max-w-lg mx-auto lg:mx-0 font-normal leading-relaxed">
              Audit IAM configurations, track security group exposure, map attack lateral movement, and run isolated drift scans. Ephemeral execution leaving no key stored.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-2">
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
            </div>

            {/* Render 3D Logo floating beneath */}
            <div className="pt-8 hidden lg:block">
              <ThreeDLogo />
            </div>
          </div>

          {/* Right Interactive Console Column */}
          <div className="lg:col-span-6 w-full" id="demo">
            <div className="relative">
              {/* Backlight halo */}
              <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full scale-105 pointer-events-none" />
              <AnimatedConsole />
            </div>
          </div>
        </div>
      </section>

      {/* 3D Logo For Mobile / Tablet */}
      <div className="lg:hidden py-10">
        <ThreeDLogo />
      </div>

      {/* Capabilities Feature Grid */}
      <section id="features" className="py-24 border-t border-border/10 bg-[#030712] relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl mb-16 text-center lg:text-left">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#f5f5f7]">Engineered for cloud experts.</h2>
            <p className="text-[#86868b] text-sm font-normal mt-2 leading-relaxed">
              No simulated states, guesses, or assumptions. Every query generates real AWS SDK/CLI requests executed dynamically.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Shield,
                title: "Zero Simulation",
                desc: "Every assessment, vulnerability finding, and configuration check pulls directly from live AWS API calls. Zero assumptions."
              },
              {
                icon: Cpu,
                title: "Smart Intent Routing",
                desc: "Classifies your natural security prompt to load only the specific tool permissions necessary for execution."
              },
              {
                icon: RefreshCw,
                title: "Stateless Security",
                desc: "Ephemeral 1-hour session credentials reside strictly in memory. We never store your AWS secret keys in a database."
              },
              {
                icon: Database,
                title: "WORM Compliance Log",
                desc: "Write-Once-Read-Many logging archives all actions securely, producing immutable compliance audit logs inside S3."
              }
            ].map((feat, i) => (
              <div key={i} className="border border-border/10 rounded-xl bg-[#090d1a]/50 p-5 hover:border-primary/20 transition-all group duration-300">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <feat.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{feat.title}</h3>
                <p className="text-[#86868b] text-xs font-normal leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security Architecture */}
      <section id="security" className="py-24 border-t border-border/10 bg-[#040816]/50 relative z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-white leading-tight">
                Stateless Memory isolation.<br />
                Your credentials are secure.
              </h2>
              <p className="text-[#86868b] text-sm leading-relaxed">
                CloudPilot exchanges temporary AWS Security Token Service (STS) credentials on-the-fly inside local sandbox environments. Your raw secret keys reside exclusively in the client's secure local context.
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
            </div>

            <div className="lg:col-span-5 border border-border/10 rounded-xl bg-[#090d1a] p-6 space-y-4">
              <h3 className="text-sm font-semibold text-white">Trust & Isolation Principles</h3>
              <p className="text-xs text-[#86868b] leading-relaxed">
                CloudPilot has been built from the ground up for maximum separation of duties. Our servers never store persistent administrative credentials. All auditing operations run as client-initiated sandbox transactions.
              </p>
              <div className="p-3.5 rounded-lg bg-[#0d142b]/60 border border-primary/20 text-[10px] font-mono text-primary leading-relaxed">
                🔒 Security Checkpoint: Local isolation verified. Local Ollama integration isolates all security scanning operations within your local network sandbox boundary.
              </div>
            </div>
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
