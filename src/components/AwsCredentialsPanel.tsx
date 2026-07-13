import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Key, ShieldCheck, ChevronDown, ChevronUp, Lock, Eye, EyeOff, Globe, Loader2, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/integrations/supabase/client";

/** Session credentials returned by the exchange endpoint — these are the ONLY credentials sent to the agent. */
export interface AwsSessionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
  region: string;
}

/** Full credentials type used by the app. Raw keys stay local; only session creds go to the agent. */
export interface AwsCredentials {
  method: "access_key" | "assume_role";
  region: string;
  /** Populated after successful exchange — ONLY these are sent with requests */
  session: AwsSessionCredentials | null;
  /** Display-only metadata */
  identity?: { account: string; arn: string };
  /** Evaluated permissions for the principal */
  permissions?: Record<string, boolean>;
  /** Original access key ID prefix for display */
  displayKeyPrefix?: string;
}

const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-central-1", "eu-north-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-south-1",
  "sa-east-1", "ca-central-1", "me-south-1", "af-south-1",
];

interface AwsCredentialsPanelProps {
  credentials: AwsCredentials | null;
  onSave: (creds: AwsCredentials) => void;
  compact?: boolean;
}

const AwsCredentialsPanel = ({ credentials, onSave, compact = false }: AwsCredentialsPanelProps) => {
  const [isOpen, setIsOpen] = useState(!credentials);
  const [method, setMethod] = useState<"access_key" | "assume_role">(credentials?.method || "access_key");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [region, setRegion] = useState(credentials?.region || "us-east-1");
  const [sessionToken, setSessionToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  const handleSave = async () => {
    setExchanging(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error("No active session. Please sign in again.");
      }

      const normalizedRegion = region.trim();
      const normalizedAccessKeyId = accessKeyId.trim().replace(/\s+/g, "");
      const normalizedSecretAccessKey = secretAccessKey.trim().replace(/\s+/g, "");
      const normalizedSessionToken = sessionToken.trim().replace(/\s+/g, "");
      const normalizedRoleArn = roleArn.trim();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = { method, region: normalizedRegion };
      if (method === "access_key") {
        if (normalizedAccessKeyId.startsWith("ASIA") && !normalizedSessionToken) {
          throw new Error("Temporary AWS credentials require a session token.");
        }

        payload.accessKeyId = normalizedAccessKeyId;
        payload.secretAccessKey = normalizedSecretAccessKey;
        if (normalizedSessionToken) payload.sessionToken = normalizedSessionToken;
      } else {
        payload.roleArn = normalizedRoleArn;
      }

      const resp = await fetch(
        `${supabaseUrl}/functions/v1/aws-exchange-credentials`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: supabaseAnonKey,
          },
          body: JSON.stringify({ credentials: payload }),
        }
      );

      let data: any = null;
      try {
        const text = await resp.text();
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        throw new Error(`Unexpected server response format (HTTP ${resp.status})`);
      }

      if (!resp.ok || data?.ok === false || !data?.sessionCredentials) {
        throw new Error(data?.error || `Validation failed (${resp.status})`);
      }

      const creds: AwsCredentials = {
        method,
        region: normalizedRegion,
        session: data.sessionCredentials,
        identity: data.identity,
        permissions: data.permissions,
        displayKeyPrefix: method === "access_key" ? normalizedAccessKeyId.slice(0, 10) : undefined,
      };

      onSave(creds);
      setIsOpen(false);
      toast.success(`Connected to AWS account ${data.identity?.account || ""}`);


      localStorage.removeItem("cloudpilot-gemini-api-key");

      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
      setRoleArn("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || "Failed to validate credentials");
    } finally {
      setExchanging(false);
    }
  };

  const isValid = method === "access_key"
    ? accessKeyId.trim() && secretAccessKey.trim() && region.trim()
    : roleArn.trim() && region.trim();

  const isExpired = credentials?.session?.expiration
    ? new Date(credentials.session.expiration) < new Date()
    : false;

  return (
    <div className={`border border-border rounded-lg bg-card overflow-hidden ${compact ? "text-xs" : ""}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded flex items-center justify-center ${
            credentials && !isExpired
              ? "bg-primary/10 border border-primary/20"
              : "bg-destructive/10 border border-destructive/20"
          }`}>
            {credentials && !isExpired ? (
              <ShieldCheck className="w-3 h-3 text-primary" />
            ) : (
              <Key className="w-3 h-3 text-destructive" />
            )}
          </div>
          <div className="text-left">
            <p className="text-xs font-medium text-foreground">
              {credentials && !isExpired
                ? "Connected (Session Token)"
                : isExpired
                ? "Session Expired"
                : "AWS Credentials"}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">
              {credentials
                ? `${credentials.displayKeyPrefix || "role"}... · ${credentials.region}${
                    credentials.identity?.account ? ` · ${credentials.identity.account}` : ""
                  }`
                : "configure to begin"}
            </p>
          </div>
        </div>
        {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
              <div className="flex gap-1.5">
                <Button
                  variant={method === "access_key" ? "terminal" : "action"}
                  size="xs"
                  onClick={() => setMethod("access_key")}
                  className="flex-1"
                >
                  <Key className="w-3 h-3" />
                  Access Key
                </Button>
                <Button
                  variant={method === "assume_role" ? "terminal" : "action"}
                  size="xs"
                  onClick={() => setMethod("assume_role")}
                  className="flex-1"
                >
                  <Lock className="w-3 h-3" />
                  Assume Role
                </Button>
              </div>

              {method === "access_key" ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Access Key ID</Label>
                    <Input
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder="AKIA..."
                      className="font-mono text-xs h-8 bg-muted border-border focus:border-primary/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Secret Access Key</Label>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                        placeholder="••••••••"
                        className="font-mono text-xs h-8 bg-muted border-border focus:border-primary/40 pr-8"
                      />
                      <button
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Role ARN</Label>
                  <Input
                    value={roleArn}
                    onChange={(e) => setRoleArn(e.target.value)}
                    placeholder="arn:aws:iam::123456789012:role/..."
                    className="font-mono text-xs h-8 bg-muted border-border focus:border-primary/40"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Region</Label>
                <div className="relative">
                  <Globe className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full h-8 pl-7 pr-3 rounded-md bg-muted border border-border text-xs font-mono text-foreground focus:border-primary/40 focus:outline-none appearance-none cursor-pointer"
                  >
                    {AWS_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              {/* Gemini API Key is configured globally on the local Deno server environment */}

              {method === "access_key" && (
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Session Token <span className="text-muted-foreground/50">optional</span></Label>
                  <Input
                    value={sessionToken}
                    onChange={(e) => setSessionToken(e.target.value)}
                    placeholder="For temporary credentials"
                    className="font-mono text-xs h-8 bg-muted border-border focus:border-primary/40"
                  />
                </div>
              )}

                <div className="flex items-center gap-2 px-2.5 py-2 bg-muted rounded border border-border">
                  <Lock className="w-3 h-3 text-primary flex-shrink-0" />
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Raw keys are validated and used only for this browser session so IAMFullAccess can attach per-service policies when a prompt needs them. Keys are never stored.
                  </p>
                </div>

              <div className="mt-2 p-3 bg-card border border-border rounded-md text-left">
                  <details className="group mb-2" open>
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] font-bold select-none">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                        How to create your AWS access key (2 clicks, no JSON)
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground group-open:hidden">SHOW</span>
                      <span className="text-[9px] font-mono text-muted-foreground hidden group-open:inline">HIDE</span>
                    </summary>
                    <ol className="mt-2 text-[10px] text-foreground/85 leading-snug list-decimal list-inside space-y-1 pl-0.5">
                      <li>Open the <a href="https://console.aws.amazon.com/iam/home#/users" target="_blank" rel="noreferrer" className="text-primary underline">IAM Users console</a> → <span className="font-mono">Create user</span>.</li>
                      <li>Name it <span className="font-mono">cloudpilot-agent</span> → <span className="font-mono">Next</span>.</li>
                      <li>
                        Choose <span className="font-mono">Attach policies directly</span>. To ensure **every single quick action prompt** (including VPC Routing, VPC Teardown, and automated remediations) works without permission errors, attach these <strong>three AWS-managed policies</strong>:
                        <ul className="list-disc list-inside ml-3 mt-1 space-y-0.5">
                          <li><span className="font-mono text-primary">SecurityAudit</span> — allows all read-only security audits and scans</li>
                          <li><span className="font-mono text-primary">AmazonVPCFullAccess</span> — allows automatic VPC routing provisioning and teardown</li>
                          <li><span className="font-mono text-primary">IAMFullAccess</span> — allows CloudPilot to auto-elevate remediation permissions on demand</li>
                        </ul>
                        *(Note: You can attach <span className="font-mono text-primary">AdministratorAccess</span> as a single alternative for full capability, or attach <span className="font-mono text-primary">SecurityAudit</span> alone if you only require read-only scans).*
                      </li>
                      <li><span className="font-mono">Next</span> → <span className="font-mono">Create user</span>.</li>
                      <li>Open the user → <span className="font-mono">Security credentials</span> → <span className="font-mono">Create access key</span> → <span className="font-mono">Application outside AWS</span>.</li>
                      <li>Paste the <span className="font-mono">AKIA…</span> key + secret above. Leave Session Token empty.</li>
                    </ol>
                    <div className="mt-2 p-2 rounded border border-primary/20 bg-primary/5 text-[10px] text-foreground/85 leading-snug">
                      <p className="font-bold text-primary mb-0.5 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> About Auto-Elevation</p>
                      <p>If you attach <span className="font-mono">IAMFullAccess</span>, CloudPilot will detect the exact service it needs (EC2, VPC, GuardDuty) and dynamically attach the matching policy to your user when you execute actions, avoiding manual setup.</p>
                    </div>
                  </details>
                  <details className="group mb-2">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-[11px] font-bold select-none">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                        Two AWS-side caveats to know
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground group-open:hidden">SHOW</span>
                      <span className="text-[9px] font-mono text-muted-foreground hidden group-open:inline">HIDE</span>
                    </summary>
                    <div className="mt-2 space-y-2 text-[10px] text-foreground/80 leading-snug">
                      <div className="p-2 rounded border border-border bg-muted/40">
                        <p className="font-bold text-foreground mb-0.5">1. Service Control Policies (SCPs)</p>
                        <p>If your AWS account is inside an AWS Organization with restrictive SCPs, those override this policy and can still block actions. Standalone accounts are unaffected.</p>
                      </div>
                      <div className="p-2 rounded border border-border bg-muted/40">
                        <p className="font-bold text-foreground mb-0.5">2. Region & resource state</p>
                        <p>The policy grants the permission, but the action still needs something to act on (e.g. an EC2 instance must exist in the selected region for <span className="font-mono">StopInstances</span> to do anything). This isn't a permission error — just AWS reality.</p>
                      </div>
                    </div>
                  </details>
                </div>

              {credentials?.permissions && Object.keys(credentials.permissions).length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-border mt-2">
                  <Label className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">IAM Capability Check (Pre-Flight)</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(credentials.permissions).map(([action, allowed]) => (
                      <div key={action} className="flex items-center gap-1.5 text-[10px] font-mono">
                        <div className={`w-2 h-2 rounded-full ${allowed ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className={allowed ? 'text-foreground' : 'text-muted-foreground'}>{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                variant="terminal"
                size="sm"
                onClick={handleSave}
                disabled={!isValid || exchanging}
                className="w-full"
              >
                {exchanging ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Validating & Exchanging...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {credentials ? "Re-authenticate" : "Connect"}
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AwsCredentialsPanel;
