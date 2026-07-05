import { motion } from "framer-motion";
import { useNavigate, Link } from "react-router-dom";
import { ArrowRight, ChevronRight, Check } from "lucide-react";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Landing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLaunch = () => {
    if (user) {
      navigate("/app");
    } else {
      navigate("/auth");
    }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] }
    }
  };

  const steps = [
    {
      num: "01",
      title: "Intent Routing",
      desc: "Queries are classified instantly to expose only the exact tools needed."
    },
    {
      num: "02",
      title: "STS Token Exchange",
      desc: "Short-lived 1-hour session credentials are acquired directly from AWS STS."
    },
    {
      num: "03",
      title: "Isolated Sandbox",
      desc: "API commands execute in serverless Deno sandboxes, leaving zero trace."
    },
    {
      num: "04",
      title: "WORM Compliance",
      desc: "All activities are write-locked and archived directly to secure S3 storage."
    }
  ];

  const plans = [
    {
      name: "Free",
      price: "0",
      desc: "Essential auditing tools for individual engineers",
      features: [
        "5 API Executions / day",
        "Single AWS Account connection",
        "VPC Routing (Standard)",
        "Basic Security Scans"
      ]
    },
    {
      name: "Pro",
      price: "49",
      desc: "Advanced cloud operations for security specialists",
      highlighted: true,
      features: [
        "Unlimited API Executions",
        "Advanced Threat Detection",
        "Real-time Alerts (Slack/PagerDuty)",
        "VPC Routing (High-throughput)",
        "Priority Email Support"
      ]
    },
    {
      name: "Enterprise",
      price: "199",
      desc: "Designed for multi-account organizations",
      features: [
        "Everything in Pro",
        "Cross-Account Role Auditing",
        "SSO & SAML Integration",
        "Immutable Audit Trails (WORM)",
        "Custom Event Policies",
        "24/7 Priority Support"
      ]
    }
  ];

  const features = [
    {
      title: "Zero Simulation Tolerance",
      desc: "Every assessment, path analysis, and finding maps directly to real AWS API execution. No mock states, no assumptions."
    },
    {
      title: "Smart Intent Router",
      desc: "An LLM-driven dispatch system classifies natural queries, loading only the exact AWS tools required to minimize token footprint."
    },
    {
      title: "Real-time Attack Scenarios",
      desc: "Simulate and detect privilege escalations, exfiltration vectors, and lateral movements directly in your isolated sandbox."
    },
    {
      title: "Automated Remediation",
      desc: "Receive exact, context-aware AWS CLI command blueprints or run immediate, safe auto-fixes with single-click checkpoints."
    }
  ];

  return (
    <div className="min-h-screen bg-background text-[#f5f5f7] font-sans overflow-x-hidden selection:bg-primary/20 selection:text-primary">
      {/* Background Radial Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[800px] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.04)_0%,transparent_70%)] pointer-events-none z-0" />

      {/* Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <CloudPilotLogo className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-xs tracking-tight text-[#f5f5f7]">CloudPilot AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-[11px] font-normal text-[#86868b]">
            <a href="#features" className="hover:text-[#f5f5f7] transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-[#f5f5f7] transition-colors">How it Works</a>
            <a href="#security" className="hover:text-[#f5f5f7] transition-colors">Security</a>
            <Link to="/security" className="text-primary hover:text-primary/90 transition-colors flex items-center gap-0.5">
              Security Center <ChevronRight className="w-2.5 h-2.5" />
            </Link>
            <a href="#pricing" className="hover:text-[#f5f5f7] transition-colors">Pricing</a>
          </nav>

          <div className="flex items-center gap-4">
            {user ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/app")}
                className="text-[11px] h-7 px-3 bg-muted hover:bg-muted/80 text-[#f5f5f7] rounded-full transition-colors font-normal"
              >
                Console
              </Button>
            ) : (
              <>
                <Link to="/auth" className="text-[11px] text-[#86868b] hover:text-[#f5f5f7] transition-colors">Sign In</Link>
                <Button
                  size="sm"
                  onClick={() => navigate("/auth")}
                  className="text-[11px] h-7 px-4 bg-[#f5f5f7] text-background hover:bg-[#e8e8ed] rounded-full transition-colors font-medium"
                >
                  Launch
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-16 md:pt-44 md:pb-24 max-w-5xl mx-auto px-6 z-10 text-center">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
          className="space-y-6"
        >
          <motion.h1
            variants={fadeUp}
            className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-[#ffffff] via-[#ffffff] to-[#86868b] leading-[1.08]"
          >
            AWS Security Intelligence.<br />Real-time operations.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-[#86868b] text-base md:text-lg max-w-xl mx-auto font-normal leading-relaxed"
          >
            Audit, isolate, and remediate cloud infrastructure in real-time. Zero key persistence. Stateful accuracy.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="flex items-center justify-center gap-6 pt-4 text-sm"
          >
            <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
              <Button
                onClick={handleLaunch}
                className="bg-[#f5f5f7] text-background hover:bg-[#e8e8ed] rounded-full px-6 py-5 font-semibold text-xs tracking-tight transition-colors"
              >
                {user ? "Enter Console" : "Launch Free Console"}
              </Button>
            </motion.div>
            <a
              href="#features"
              className="text-[#86868b] hover:text-primary transition-colors flex items-center gap-1 text-xs group"
            >
              <span>Explore capabilities</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </motion.div>
        </motion.div>

        {/* Clean, Floating Product Screen Showcase with backlighting */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="mt-16 md:mt-24 max-w-4xl mx-auto relative rounded-xl overflow-hidden shadow-2xl shadow-blue-500/5 bg-card border border-border/40"
        >
          {/* Subtle backdrop backlight */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.06)_0%,transparent_50%)] pointer-events-none" />
          <img
            src="/dashboard_mockup.png"
            className="w-full h-auto object-contain opacity-95 relative z-10"
            alt="CloudPilot AI Platform"
          />
        </motion.div>
      </section>

      {/* Capabilities Section */}
      <section id="features" className="py-32 border-t border-border/40 bg-background relative z-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="max-w-2xl mb-24">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#f5f5f7]">Designed for professionals.</h2>
            <p className="text-[#86868b] text-base font-normal mt-3 leading-relaxed">
              No simulated states. Every finding and path analysis maps directly to real-time AWS API client transactions.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-x-16 gap-y-16">
            {features.map((feat) => (
              <div key={feat.title} className="space-y-3">
                <h3 className="text-sm font-semibold text-[#f5f5f7]">{feat.title}</h3>
                <p className="text-[#86868b] text-xs font-normal leading-relaxed">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works (Apple style - simple numbers and space) */}
      <section id="how-it-works" className="py-32 border-t border-border/40 bg-background/50 relative z-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="max-w-2xl mb-24">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#f5f5f7]">How it works.</h2>
            <p className="text-[#86868b] text-base font-normal mt-3 leading-relaxed">
              CloudPilot runs as a stateless client routing agent, executing ephemeral session calls without persistent DB key storage.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-12">
            {steps.map((step) => (
              <div key={step.num} className="space-y-4 group">
                <div className="text-4xl md:text-5xl font-light text-[#1d1d1f] group-hover:text-primary/30 transition-colors">{step.num}</div>
                <h3 className="text-xs font-semibold text-[#f5f5f7]">{step.title}</h3>
                <p className="text-[#86868b] text-xs font-normal leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security is our Core Foundation (Apple style) */}
      <section id="security" className="py-32 border-t border-border/40 bg-background relative z-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-12 gap-12 items-center">
            {/* Left Info */}
            <div className="md:col-span-7 space-y-6">
              <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-[#f5f5f7] leading-tight">
                Your credentials.<br />Strictly in memory.
              </h2>
              <p className="text-[#86868b] text-sm font-normal leading-relaxed">
                CloudPilot never stores raw AWS keys. Short-lived tokens are exchanged on-the-fly via TLS to maintain credential isolation, governed by serverless firewalls.
              </p>
              <div className="space-y-3 pt-2">
                {[
                  "No persistent database storage of AWS keys",
                  "Temporary STS session configuration with 1-hour limits",
                  "Write-Once-Read-Many (WORM) audit histories",
                  "Automated pre-flight blocklists for toxic actions"
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-xs text-[#86868b]">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <Link
                  to="/security"
                  className="text-primary hover:text-primary/90 text-xs font-medium inline-flex items-center gap-0.5"
                >
                  Verify our full security architecture <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>

            {/* Right Graphic Console Mockup */}
            <div className="md:col-span-5 p-6 rounded-xl bg-card border border-border/40 space-y-4 relative">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-mono text-neutral-400">POLICY: ACTIVE</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-500">SECURE</span>
              </div>
              <div className="space-y-2 font-mono text-[9px]">
                <div className="flex justify-between p-1.5 rounded bg-background border border-border/20">
                  <span className="text-neutral-500">RULE_01: s3:PutBucketPolicy</span>
                  <span className="text-emerald-500">ALLOW</span>
                </div>
                <div className="flex justify-between p-1.5 rounded bg-background border border-border/20">
                  <span className="text-neutral-500">RULE_02: iam:DeactivateAccessKey</span>
                  <span className="text-amber-500">CONFIRM</span>
                </div>
                <div className="flex justify-between p-1.5 rounded bg-background border border-border/20">
                  <span className="text-neutral-500">RULE_03: deleteOrganization</span>
                  <span className="text-rose-500">BLOCKED</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing / Tiers Section (Apple Column Style) */}
      <section id="pricing" className="py-32 border-t border-border/40 bg-background/50 relative z-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center space-y-3 mb-24">
            <h2 className="text-3xl font-semibold tracking-tight text-[#f5f5f7]">Choose your tier.</h2>
            <p className="text-[#86868b] text-sm font-normal">Transparent tiers mapping to your operational scale.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-x-12 gap-y-16 items-start">
            {plans.map((plan) => (
              <div key={plan.name} className="space-y-8">
                <div className="space-y-3">
                  <h3 className="text-base font-semibold text-[#f5f5f7]">{plan.name}</h3>
                  <p className="text-[#86868b] text-xs font-normal leading-relaxed min-h-8">{plan.desc}</p>
                </div>

                <div className="flex items-baseline gap-1 text-2xl md:text-3xl font-semibold text-[#f5f5f7]">
                  <span>{plan.price === "0" ? "Free" : `$${plan.price}`}</span>
                  {plan.price !== "0" && <span className="text-xs text-[#86868b] font-normal"> / mo</span>}
                </div>

                <ul className="space-y-3 pt-6 border-t border-border/40">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2.5 text-xs text-[#86868b]">
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
                  <Button
                    onClick={handleLaunch}
                    className={`w-full rounded-full text-xs font-medium py-5 transition-colors ${
                      plan.highlighted
                        ? "bg-[#f5f5f7] text-background hover:bg-[#e8e8ed]"
                        : "bg-muted text-[#f5f5f7] hover:bg-[#2d2d2f]"
                    }`}
                  >
                    Select Plan
                  </Button>
                </motion.div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Apple-style Footer Notes and Site Map */}
      <footer className="border-t border-border/40 bg-background z-10 relative text-[#86868b]">
        <div className="max-w-5xl mx-auto px-6 py-16 space-y-12">
          {/* Footnotes */}
          <div className="space-y-3 text-[10px] leading-relaxed font-light border-b border-border/40 pb-10">
            <p>1. Daily API execution limits reset at 00:00 UTC. Free plan users are limited to 5 successful role-auditing requests per calendar day.</p>
            <p>2. VPC Routing utilizes standard Deno sandbox runtime configurations. High-throughput performance and isolated transit routing thresholds require Pro or Enterprise seat registrations.</p>
            <p>3. CloudPilot AI stateless processing exchanges credentials directly using transient AWS Security Token Service (STS) assumes. Raw API keys reside only in client browser context memory and are transmitted strictly via HTTPS/TLS 1.3 encryption protocols.</p>
          </div>

          {/* Directory Map */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-[11px]">
            <div className="space-y-3">
              <h4 className="text-white font-medium">Explore</h4>
              <ul className="space-y-2 font-light">
                <li><a href="#features" className="hover:text-white transition-colors">Capabilities</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition-colors">Timeline</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Plans</a></li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="text-white font-medium">Security</h4>
              <ul className="space-y-2 font-light">
                <li><Link to="/security" className="hover:text-white transition-colors">Disclosure Center</Link></li>
                <li><a href="#security" className="hover:text-white transition-colors">STS Token exchange</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Isolation sandboxes</a></li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="text-white font-medium">Resource</h4>
              <ul className="space-y-2 font-light">
                <li><a href="https://github.com/ritvikindupuri/aws-ai-agent" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub Repository</a></li>
                <li><a href="https://github.com/ritvikindupuri/aws-ai-agent/blob/main/TECHNICAL_DOCUMENTATION.md" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="https://github.com/ritvikindupuri/aws-ai-agent/issues" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Support</a></li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="text-white font-medium">CloudPilot</h4>
              <ul className="space-y-2 font-light">
                <li><span className="text-neutral-500 font-mono">Console v1.0</span></li>
                <li><span className="text-neutral-500">Security Operations</span></li>
              </ul>
            </div>
          </div>

          {/* Copyright line */}
          <div className="pt-4 flex flex-col md:flex-row justify-between items-center text-[10px] font-light gap-4">
            <p>© 2026 CloudPilot AI. Built for AWS cloud security operations.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors">Terms of Use</a>
              <a href="#" className="hover:text-white transition-colors">Legal Disclosures</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
