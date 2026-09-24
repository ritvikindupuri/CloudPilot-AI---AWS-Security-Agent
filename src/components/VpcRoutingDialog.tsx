import { motion, AnimatePresence } from "framer-motion";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { type AwsCredentials } from "@/components/AwsCredentialsPanel";

interface VpcRoutingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: AwsCredentials | null;
  onAccept: () => void;
  onDecline: () => void;
  onReAuthenticate?: (creds: AwsCredentials) => void;
}

// VPC permissions are auto-granted on demand by aws-executor; no static list needed here.

export const VpcRoutingDialog = ({
  open,
  onOpenChange,
  credentials,
  onAccept,
  onDecline,
  onReAuthenticate,
}: VpcRoutingDialogProps) => {
  const handleYes = () => {
    // The aws-executor will return clear permission errors if the IAM principal
    // lacks required permissions. Users should attach appropriate policies
    // (e.g., AmazonEC2FullAccess) manually to their IAM principal before
    // attempting VPC operations.
    onAccept();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden border-border bg-card">
        <AnimatePresence mode="wait">
          <motion.div
              key="prompt"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="p-6"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Server className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground mb-1">Route agent through AWS VPC?</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Would you like to start a guided workflow for routing the agent through an isolated AWS VPC?
                    CloudPilot will automatically attach <span className="font-mono text-foreground">AmazonEC2FullAccess</span> to your IAM principal on demand and provision the networking resources.
                  </p>
                  <div className="mt-3 p-3 bg-muted/30 rounded-md border border-border text-left">
                    <p className="text-xs font-semibold mb-1">Required at setup (one-time):</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      <span className="font-mono text-foreground">SecurityAudit</span> + <span className="font-mono text-foreground">IAMFullAccess</span> AWS-managed policies on your IAM user. Per-service permissions (EC2, VPC, NAT, etc.) are granted automatically when needed.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-4 w-full">
                  <Button variant="outline" className="flex-1" onClick={onDecline}>
                    No, skip
                  </Button>
                  <Button variant="action" className="flex-1" onClick={handleYes}>
                    Yes, route through VPC
                  </Button>
                </div>
              </div>
            </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default VpcRoutingDialog;
