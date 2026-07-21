import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Check, X, Sparkles } from "lucide-react";
import { FastScanIcon, DeepAuditIcon } from "./ScanModeIcons";
import { AwsCredentials } from "./AwsCredentialsPanel";

const POLICY_COVERED_PREFIXES = [
  "apigateway:", "budgets:", "ce:", "cloudtrail:", "cloudwatch:", "config:",
  "dynamodb:", "ec2:", "ecs:", "elasticloadbalancing:", "guardduty:", "iam:",
  "lambda:", "logs:", "organizations:", "rds:", "s3:", "secretsmanager:",
  "securityhub:", "ses:", "sns:", "ssm:", "sts:", "wafv2:",
];

interface QuickActionPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  actionLabel: string;
  requiredPermissions: string[];
  credentials: AwsCredentials | null;
  onConfirm: () => void;
  recommendedMode?: "fast" | "deep";
  recommendationReason?: string;
}

export function QuickActionPermissionsDialog({
  open,
  onOpenChange,
  prompt,
  actionLabel,
  requiredPermissions,
  credentials,
  onConfirm,
  recommendedMode = "fast",
  recommendationReason,
}: QuickActionPermissionsDialogProps) {
  const canAutoGrant = Boolean(
    credentials?.permissions?.["iam:AttachUserPolicy"] ||
    credentials?.permissions?.["iam:AttachRolePolicy"]
  );
  const isCoveredByAutoGrant = (permission: string) =>
    POLICY_COVERED_PREFIXES.some((prefix) => permission.toLowerCase().startsWith(prefix));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Permissions Check: {actionLabel}
          </DialogTitle>
          <DialogDescription className="text-xs">
            To execute this action, the following IAM permissions are required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 mt-4 space-y-4">
          {/* Smart Mode Recommendation Banner */}
          <div className={`border rounded-lg p-3 text-xs flex items-start gap-2.5 ${
            recommendedMode === "deep"
              ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          }`}>
            {recommendedMode === "deep" ? (
              <DeepAuditIcon className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            ) : (
              <FastScanIcon className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <span className="font-bold block text-xs mb-0.5">
                {recommendedMode === "deep" ? "🔍 Deep Audit Recommended" : "⚡ Fast Scan Optimal"}
              </span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {recommendationReason || (recommendedMode === "deep"
                  ? "Multi-pass recursive analysis recommended for full attack path mapping and compliance benchmarking."
                  : "Single-pass execution handles this query fast (~2–5s) with low token footprint.")}
              </p>
            </div>
          </div>

          <div className="border border-border/80 rounded-lg bg-card/60 p-3 text-xs leading-relaxed text-muted-foreground border-blue-500/10">
            <span className="font-bold text-foreground block mb-1">Action Description</span>
            {prompt}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Required Permissions */}
            <div className="border border-border rounded-lg bg-card/50 p-3">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase mb-2">Required Permissions</h4>
              <ul className="space-y-1.5">
                {requiredPermissions.length === 0 ? (
                  <li className="text-[11px] text-muted-foreground">None explicitly defined</li>
                ) : (
                  requiredPermissions.map((perm) => (
                    <li key={perm} className="text-[11px] font-mono text-foreground flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50" />
                      {perm}
                    </li>
                  ))
                )}
              </ul>
            </div>

            {/* Current Permissions */}
            <div className="border border-border rounded-lg bg-card/50 p-3">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase mb-2">Runtime Status</h4>
              <ul className="space-y-1.5">
                {requiredPermissions.length === 0 ? (
                  <li className="text-[11px] text-muted-foreground">N/A</li>
                ) : (
                  requiredPermissions.map((perm) => {
                    const isAllowed = credentials?.permissions?.[perm];
                    return (
                      <li key={perm} className="text-[11px] font-mono flex items-center gap-1.5">
                        {isAllowed === true ? (
                          <><Check className="w-3 h-3 text-green-500" /><span className="text-green-400">Allowed</span></>
                        ) : canAutoGrant && isCoveredByAutoGrant(perm) ? (
                          <><ShieldCheck className="w-3 h-3 text-primary" /><span className="text-primary">Auto-granted at runtime</span></>
                        ) : isAllowed === false ? (
                          <><X className="w-3 h-3 text-red-500" /><span className="text-red-400">Needs IAMFullAccess</span></>
                        ) : (
                          <><ShieldAlert className="w-3 h-3 text-yellow-500" /><span className="text-yellow-500">Unverified (Test at runtime)</span></>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4 pt-4 border-t border-border flex justify-between sm:justify-between items-center">
          <p className="text-[10px] text-muted-foreground">
            CloudPilot attaches the needed AWS-managed policy before retrying any missing service permission.
          </p>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button variant="action" size="sm" onClick={onConfirm}>
              Execute with Auto-Grant
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
