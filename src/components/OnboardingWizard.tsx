import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Key, Bell, Rocket, ChevronRight, ChevronLeft, CheckCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import CloudPilotLogo from "@/components/CloudPilotLogo";

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

const STEPS = [
  {
    id: "welcome",
    icon: Rocket,
    title: "Welcome to CloudPilot AI",
    subtitle: "Your AWS Security Intelligence Platform",
    description:
      "CloudPilot connects to your AWS account using temporary session tokens to audit security posture, detect drift, analyze costs, and simulate attack paths — all in real time.",
    tips: [
      "Every query executes real AWS API calls — no simulations",
      "Raw keys are exchanged for temporary STS tokens immediately",
      "Dynamic policy attachment expands permissions safely as needed",
    ],
  },
  {
    id: "credentials",
    icon: Key,
    title: "Connect Your AWS Account",
    subtitle: "Step 1 of 2",
    description:
      "Use the AWS Credentials panel on the left sidebar to enter your Access Key ID and Secret Access Key. CloudPilot will exchange these for temporary session tokens via STS — your raw keys are never stored or sent to the AI agent.",
    tips: [
      "Use a scoped-down IAM role — never AdministratorAccess",
      "Attach SecurityAudit and IAMFullAccess for optimal permission scaling",
      "Credentials are validated and used only for the active browser session",
    ],
  },
  {
    id: "ready",
    icon: Bell,
    title: "You're All Set!",
    subtitle: "Step 2 of 2",
    description:
      "Start by running a quick audit. Type 'show me everything wrong with my AWS account' or use the Quick Actions panel. CloudPilot will perform a comprehensive security assessment and return actionable findings.",
    tips: [
      "Use the Reports page to view and export past audit reports",
      "Interact with findings directly to remediate cloud exposures",
      "Try 'am I SOC2 ready?' for compliance-focused auditing",
    ],
  },
];

const OnboardingWizard = ({ onComplete, onSkip }: OnboardingWizardProps) => {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-lg bg-card border border-border rounded-2xl p-8 space-y-6 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center">
              <current.icon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">{current.subtitle}</p>
              <h2 className="text-lg font-bold text-foreground">{current.title}</h2>
            </div>
          </div>
          <button
            onClick={onSkip}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
        </div>

        {/* Content */}
        <p className="text-sm text-muted-foreground leading-relaxed">{current.description}</p>

        {/* Tips */}
        <div className="space-y-2.5">
          {current.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[12px]">
              <CheckCircle className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-foreground/80">{tip}</span>
            </div>
          ))}
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all ${
                i === step ? "bg-primary w-6" : i < step ? "bg-primary/40" : "bg-border"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            className="gap-1.5"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </Button>
          <Button
            variant="terminal"
            size="sm"
            onClick={isLast ? onComplete : () => setStep(step + 1)}
            className="gap-1.5"
          >
            {isLast ? "Get Started" : "Next"}
            {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default OnboardingWizard;
