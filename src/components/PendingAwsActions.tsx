import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/integrations/supabase/client";

interface PendingAction {
  id: string;
  service: string;
  operation: string;
  summary: string;
  expires_at: string;
  status: string;
}

export default function PendingAwsActions({ enabled }: { enabled: boolean }) {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    const resp = await fetch(`${supabaseUrl}/functions/v1/aws-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ action: "list_pending_actions" }),
    });
    if (!resp.ok) return;
    const body = await resp.json().catch(() => ({}));
    setActions(Array.isArray(body.actions) ? body.actions : []);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  const decide = async (approvalId: string, decision: "approve" | "reject") => {
    setBusyId(approvalId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const resp = await fetch(`${supabaseUrl}/functions/v1/aws-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          action: decision === "approve" ? "approve_pending_action" : "reject_pending_action",
          approvalId,
        }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || "Request failed");
      toast.success(decision === "approve" ? "AWS change approved and executed" : "AWS change rejected");
      await refresh();
    } catch (err: any) {
      toast.error("Could not update the pending AWS change.");
    } finally {
      setBusyId(null);
    }
  };

  if (!enabled || actions.length === 0) return null;

  return (
    <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
        <ShieldAlert className="w-4 h-4" />
        Pending AWS changes need a UI approval
      </div>
      {actions.map((action) => (
        <div key={action.id} className="flex items-center justify-between gap-2 text-xs">
          <div>
            <div className="font-mono text-foreground">{action.summary || `${action.service}.${action.operation}`}</div>
            <div className="text-muted-foreground">Expires {new Date(action.expires_at).toLocaleString()}</div>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={busyId === action.id} onClick={() => decide(action.id, "approve")}>
              <Check className="w-3 h-3 mr-1" /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busyId === action.id} onClick={() => decide(action.id, "reject")}>
              <X className="w-3 h-3 mr-1" /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
