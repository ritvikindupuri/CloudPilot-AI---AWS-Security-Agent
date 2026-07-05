import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Shield,
  Key,
  Terminal,
  Activity,
  ArrowLeft,
  Lock,
  Cpu,
  RefreshCw,
  Eye,
  Server,
  FileCheck
} from "lucide-react";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { Button } from "@/components/ui/button";

export const Security = () => {
  const [activeStep, setActiveStep] = useState<number>(0);

  const keyExchangeSteps = [
    {
      title: "1. Client Auth & TLS Entry",
      desc: "User inputs credentials on the client. They are encrypted in memory and transmitted exclusively over HTTPS/TLS to the Supabase Deno Edge Function isolate. Raw keys never touch any persistent backend storage.",
      icon: Key
    },
    {
      title: "2. STS Token Exchange",
      desc: "The edge function communicates directly with AWS STS (Security Token Service) to request a short-lived, temporary session token. The session is configured with a strict 1-hour expiration time.",
      icon: RefreshCw
    },
    {
      title: "3. Ephemeral Sandbox Execution",
      desc: "The temporary session token is loaded into a stateless, sandboxed Deno execution context. The agent uses this session to call AWS APIs. When the execution completes, the sandbox is immediately destroyed.",
      icon: Cpu
    },
    {
      title: "4. WORM S3 Logging",
      desc: "Every API call payload is permanently archived to a Write-Once-Read-Many (WORM) S3 bucket. These logs are write-locked and serve as an unalterable audit trail for security compliance.",
      icon: FileCheck
    }
  ];

  return (
    <div className="min-h-screen bg-[#070b15] text-[#e2e8f0] font-sans selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      {/* Background mesh glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[500px] bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.08)_0%,transparent_65%)] pointer-events-none z-0" />
      <div className="absolute top-[400px] right-0 w-[400px] h-[400px] bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.04)_0%,transparent_60%)] pointer-events-none z-0" />

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-blue-950/40 bg-[#070b15]/75 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="w-9 h-9 rounded-xl bg-blue-950/20 border border-blue-900/30 flex items-center justify-center">
              <CloudPilotLogo className="w-5.5 h-5.5 text-white" />
            </Link>
            <span className="font-bold text-base tracking-tight text-white">CloudPilot AI</span>
          </div>

          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Landing
            </Link>
            <Button
              size="sm"
              asChild
              className="text-xs bg-white text-black hover:bg-neutral-200 rounded-full px-5 font-semibold"
            >
              <Link to="/auth">Launch Console</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative pt-32 pb-16 max-w-5xl mx-auto px-6 z-10 space-y-16">
        <div className="text-center space-y-6 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/40 border border-blue-900/40 text-blue-400 text-xs">
            <Shield className="w-3.5 h-3.5" />
            <span>Security & Compliance Center</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-[#94a3b8] leading-tight">
            Security by Architecture.
          </h1>
          <p className="text-[#94a3b8] text-base md:text-lg font-light leading-relaxed">
            CloudPilot AI utilizes short-lived session tokens, sandboxed runtime environments, and pre-flight API boundaries to guarantee your AWS infrastructure is audited with zero credential exposure.
          </p>
        </div>

        {/* Interactive Diagram Section */}
        <section className="bg-blue-950/10 border border-blue-900/20 rounded-3xl p-6 md:p-10 space-y-8">
          <div className="text-center md:text-left space-y-2">
            <h2 className="text-xl font-bold text-white flex items-center justify-center md:justify-start gap-2">
              <Lock className="w-5 h-5 text-primary" />
              <span>Interactive Flow: STS Token Exchange</span>
            </h2>
            <p className="text-xs text-[#94a3b8]">Click the steps below to trace how credentials flow securely through the system.</p>
          </div>

          <div className="grid md:grid-cols-12 gap-8 items-start">
            {/* Steps list */}
            <div className="md:col-span-5 space-y-3">
              {keyExchangeSteps.map((step, idx) => {
                const Icon = step.icon;
                const isSelected = activeStep === idx;
                return (
                  <button
                    key={step.title}
                    onClick={() => setActiveStep(idx)}
                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-start gap-4 ${
                      isSelected
                        ? "bg-[#0b1329] border-primary/40 shadow-lg shadow-primary/5"
                        : "bg-transparent border-blue-950/40 hover:bg-blue-950/10 hover:border-blue-900/30"
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      isSelected ? "bg-primary/10 text-primary" : "bg-blue-950/30 text-blue-400"
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className={`text-xs font-semibold ${isSelected ? "text-white" : "text-neutral-400"}`}>{step.title}</h3>
                      <p className="text-[11px] text-[#94a3b8] line-clamp-1 mt-1">{step.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Interactive Visualizer Card */}
            <div className="md:col-span-7 p-6 rounded-2xl bg-[#0a0f1d] border border-blue-900/20 aspect-[4/3] flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.04)_0%,transparent_60%)] pointer-events-none" />

              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-blue-950/50 pb-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Server className="w-4 h-4 text-blue-400" />
                    <span>Visual Tracer: Step {activeStep + 1}</span>
                  </div>
                  <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">ACTIVE</span>
                </div>

                <div className="min-h-24 py-2">
                  <motion.p
                    key={activeStep}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="text-xs text-[#94a3b8] leading-relaxed font-light"
                  >
                    {keyExchangeSteps[activeStep].desc}
                  </motion.p>
                </div>
              </div>

              {/* Animated Connection Nodes */}
              <div className="relative h-24 border border-blue-950/50 rounded-xl bg-[#070b15]/50 flex items-center justify-around px-4">
                <div className="flex flex-col items-center gap-1.5 z-10">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                    activeStep === 0 ? "bg-primary/20 border-primary text-primary" : "bg-blue-950/40 border-blue-900/30 text-blue-400"
                  }`}>
                    <Eye className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-mono text-[#94a3b8]">Client</span>
                </div>

                <div className="h-0.5 flex-1 bg-gradient-to-r from-blue-900/30 to-blue-900/30 relative mx-2">
                  {activeStep === 1 && (
                    <motion.div
                      animate={{ x: ["0%", "100%"] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"
                    />
                  )}
                </div>

                <div className="flex flex-col items-center gap-1.5 z-10">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                    activeStep === 1 || activeStep === 2 ? "bg-primary/20 border-primary text-primary" : "bg-blue-950/40 border-blue-900/30 text-blue-400"
                  }`}>
                    <Server className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-mono text-[#94a3b8]">Orchestrator</span>
                </div>

                <div className="h-0.5 flex-1 bg-gradient-to-r from-blue-900/30 to-blue-900/30 relative mx-2">
                  {activeStep === 3 && (
                    <motion.div
                      animate={{ x: ["0%", "100%"] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary"
                    />
                  )}
                </div>

                <div className="flex flex-col items-center gap-1.5 z-10">
                  <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
                    activeStep === 3 ? "bg-primary/20 border-primary text-primary" : "bg-blue-950/40 border-blue-900/30 text-blue-400"
                  }`}>
                    <Lock className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-mono text-[#94a3b8]">AWS STS</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Detailed Security Pillars */}
        <section className="grid md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-blue-950/5 border border-blue-900/10 space-y-4">
            <div className="w-10 h-10 rounded-lg bg-blue-950/30 border border-blue-900/20 flex items-center justify-center text-primary">
              <Key className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Zero Key Retention</h3>
            <p className="text-xs text-[#94a3b8] font-light leading-relaxed">
              Your raw AWS IAM keys reside entirely in the client browser's session storage. During requests, keys are passed over TLS to exchange for 1-hour session credentials and are never stored in a database.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-blue-950/5 border border-blue-900/10 space-y-4">
            <div className="w-10 h-10 rounded-lg bg-blue-950/30 border border-blue-900/20 flex items-center justify-center text-primary">
              <Terminal className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Smart Intent Firewall</h3>
            <p className="text-xs text-[#94a3b8] font-light leading-relaxed">
              An intent classification model processes requests first. If a query attempts actions outside its classified scope, the agent declines tool injection, neutralizing prompt injection attacks.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-blue-950/5 border border-blue-900/10 space-y-4">
            <div className="w-10 h-10 rounded-lg bg-blue-950/30 border border-blue-900/20 flex items-center justify-center text-primary">
              <Activity className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Execution Safety Rules</h3>
            <p className="text-xs text-[#94a3b8] font-light leading-relaxed">
              Every query is evaluated against a pre-flight execution policy. Destructive account-level actions (e.g. `deleteOrganization`, `closeAccount`) are hard-blocked on the server, guaranteeing safe operation.
            </p>
          </div>
        </section>

        {/* Compliance Section */}
        <section className="border-t border-blue-950/60 pt-16 flex flex-col md:flex-row gap-8 items-center justify-between">
          <div className="space-y-3 max-w-xl">
            <h2 className="text-xl font-bold text-white">Ready for Audits & Compliance Scans</h2>
            <p className="text-xs text-[#94a3b8] font-light leading-relaxed">
              CloudPilot logging generates unalterable S3 logs compatible with SOC 2, HIPAA, and ISO 27001 requirements. Security assessors can verify every query executed by the LLM agent using standard AWS CloudTrail logs.
            </p>
          </div>
          <Button
            asChild
            className="bg-white text-black hover:bg-neutral-200 font-semibold rounded-full px-6"
          >
            <Link to="/auth">Connect AWS Account</Link>
          </Button>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-blue-950/40 py-10 text-center text-xs text-neutral-600">
        <p>© 2026 CloudPilot AI. Security Disclosure Statement.</p>
      </footer>
    </div>
  );
};

export default Security;
