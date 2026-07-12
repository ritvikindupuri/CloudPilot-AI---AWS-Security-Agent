import { useState, useEffect } from "react";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/integrations/supabase/client";
import { Bell, Plus, Trash2, Loader2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface WebhookRow {
  id: string;
  channel_type: string;
  label: string;
  subscribed_events: string[];
  is_active: boolean;
  created_at: string;
}

const WebhookSettings = () => {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    channel_type: "slack" as "slack" | "pagerduty" | "generic",
    webhook_url: "",
    label: "",
  });

  const callWebhookApi = async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || supabaseAnonKey;
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/webhook-notify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }
    );
    return resp.json();
  };

  const loadWebhooks = async () => {
    try {
      const data = await callWebhookApi({ action: "list" });
      setWebhooks(data.webhooks || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWebhooks();
  }, []);

  const handleAdd = async () => {
    if (!form.webhook_url.trim()) {
      toast.error("Webhook URL is required");
      return;
    }
    setAdding(true);
    try {
      const result = await callWebhookApi({
        action: "register",
        channel_type: form.channel_type,
        webhook_url: form.webhook_url.trim(),
        label: form.label.trim() || form.channel_type,
        events: ["guardian_alert", "auto_fix", "drift_detected", "cost_anomaly", "scan_complete"],
      });
      if (result.error) throw new Error(result.error);
      toast.success("Webhook registered successfully");
      setShowForm(false);
      setForm({ channel_type: "slack", webhook_url: "", label: "" });
      loadWebhooks();
    } catch (err: any) {
      toast.error(err.message || "Failed to register webhook");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await callWebhookApi({ action: "delete", webhookId: id });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      toast.success("Webhook removed");
    } catch {
      toast.error("Failed to remove webhook");
    }
  };

  const channelIcon = (type: string) => {
    if (type === "slack") return "🔔";
    if (type === "pagerduty") return "🚨";
    return "🔗";
  };

  return (
    <div className="border border-border rounded-lg bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Bell className="w-3 h-3 text-muted-foreground" />
          <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">WEBHOOKS</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="h-6 px-2 text-[10px]"
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 border border-border rounded-lg p-2.5 bg-muted/30">
          <div className="flex gap-1">
            {(["slack", "pagerduty", "generic"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setForm({ ...form, channel_type: type })}
                className={`flex-1 text-[10px] py-1.5 rounded font-mono transition-colors ${
                  form.channel_type === type
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "bg-muted text-muted-foreground border border-border hover:text-foreground"
                }`}
              >
                {channelIcon(type)} {type}
              </button>
            ))}
          </div>
          <Input
            value={form.webhook_url}
            onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
            placeholder={form.channel_type === "pagerduty" ? "PagerDuty routing key" : "https://hooks.slack.com/..."}
            className="font-mono text-xs h-7 bg-muted"
          />
          <Input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Label (optional)"
            className="text-xs h-7 bg-muted"
          />
          <Button
            variant="terminal"
            size="sm"
            onClick={handleAdd}
            disabled={adding}
            className="w-full text-xs h-7"
          >
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add Webhook"}
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-[10px] text-muted-foreground">Loading...</p>
      ) : webhooks.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No webhooks configured. Add Slack or PagerDuty to receive external alerts.</p>
      ) : (
        <div className="space-y-1.5">
          {webhooks.map((wh) => (
            <div key={wh.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted/30 border border-border">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm">{channelIcon(wh.channel_type)}</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-foreground truncate">{wh.label}</p>
                  <p className="text-[9px] text-muted-foreground font-mono">{wh.channel_type}</p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(wh.id)}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WebhookSettings;
