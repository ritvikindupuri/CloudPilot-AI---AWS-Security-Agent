import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Users, UserPlus, Shield, Crown, Eye, Trash2, ChevronDown, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type AppRole = "owner" | "admin" | "member" | "viewer";

interface OrgMember {
  id: string;
  user_id: string;
  role: AppRole;
  joined_at: string;
  email?: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
}

const ROLE_META: Record<AppRole, { label: string; icon: typeof Crown; color: string; description: string }> = {
  owner: { label: "Owner", icon: Crown, color: "text-amber-400", description: "Full control — billing, delete org, manage all members" },
  admin: { label: "Admin", icon: Shield, color: "text-primary", description: "Manage members, credentials, and policies" },
  member: { label: "Member", icon: Users, color: "text-foreground", description: "Use agent, view reports, manage own credentials" },
  viewer: { label: "Viewer", icon: Eye, color: "text-muted-foreground", description: "Read-only access to reports and dashboards" },
};

const Team = () => {
  const { user } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [myRole, setMyRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("member");
  const [inviting, setInviting] = useState(false);
  const [editingMember, setEditingMember] = useState<OrgMember | null>(null);
  const [newRole, setNewRole] = useState<AppRole>("member");

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const loadOrg = useCallback(async () => {
    if (!user) return;
    // Get user's org via org_members
    const { data: membership } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!membership) {
      setLoading(false);
      return;
    }

    setMyRole(membership.role as AppRole);

    const { data: orgData } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", membership.org_id)
      .single();

    if (orgData) setOrg(orgData);

    // Load members with emails via edge function
    try {
      const { data, error } = await supabase.functions.invoke("team-invite", {
        body: { action: "list_members_with_emails", org_id: membership.org_id },
      });

      if (!error && data?.members) {
        setMembers(data.members.map((m: any) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role as AppRole,
          joined_at: m.joined_at,
          email: m.email || undefined,
        })));
      }
    } catch {
      // Fallback: load from org_members directly (no emails)
      const { data: membersData } = await supabase
        .from("org_members")
        .select("*")
        .eq("org_id", membership.org_id)
        .order("joined_at", { ascending: true });

      if (membersData) {
        setMembers(membersData.map((m) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role as AppRole,
          joined_at: m.joined_at,
        })));
      }
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const handleInvite = async () => {
    if (!org || !user || !inviteEmail.trim()) return;
    setInviting(true);

    try {
      const { data, error } = await supabase.functions.invoke("team-invite", {
        body: {
          action: "invite",
          email: inviteEmail.trim(),
          role: inviteRole,
          org_id: org.id,
        },
      });

      if (error) {
        const errMsg = typeof data === "object" && data?.error ? data.error : "Failed to send invite";
        toast.error(errMsg);
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (data?.member) {
        setMembers((prev) => [...prev, {
          id: data.member.id,
          user_id: data.member.user_id,
          role: data.member.role as AppRole,
          joined_at: data.member.joined_at,
          email: data.member.email,
        }]);
        toast.success(`${data.member.email} added as ${inviteRole}`);
      }

      setShowInvite(false);
      setInviteEmail("");
      setInviteRole("member");
    } catch (err) {
      toast.error("Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async () => {
    if (!editingMember || !org) return;

    const { error } = await supabase
      .from("org_members")
      .update({ role: newRole })
      .eq("id", editingMember.id);

    if (error) {
      toast.error("Failed to update role");
      return;
    }

    setMembers((prev) =>
      prev.map((m) => (m.id === editingMember.id ? { ...m, role: newRole } : m))
    );
    toast.success(`Role updated to ${ROLE_META[newRole].label}`);
    setEditingMember(null);
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (member.role === "owner") {
      toast.error("Cannot remove the organization owner");
      return;
    }

    const { error } = await supabase
      .from("org_members")
      .delete()
      .eq("id", member.id);

    if (error) {
      toast.error("Failed to remove member");
      return;
    }

    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    toast.success("Member removed");
  };

  const badgeClass = (role: AppRole) => {
    switch (role) {
      case "owner": return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "admin": return "bg-primary/10 text-primary border-primary/30";
      case "member": return "bg-muted text-foreground border-border";
      case "viewer": return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/70 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono text-muted-foreground tracking-widest uppercase">Team Management</p>
            <h1 className="text-2xl font-bold text-foreground mt-1">
              {org?.name || "Your Organization"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage team members, roles, and organization-level access to AWS credentials.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <Button variant="terminal" size="sm" onClick={() => setShowInvite(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Member
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/app">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Chat
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Role Legend */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {(Object.entries(ROLE_META) as [AppRole, typeof ROLE_META[AppRole]][]).map(([role, meta]) => {
            const Icon = meta.icon;
            const count = members.filter((m) => m.role === role).length;
            return (
              <div key={role} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase">{meta.label}s</p>
                    <p className="text-3xl font-bold text-foreground mt-2">{count}</p>
                  </div>
                  <Icon className={`w-5 h-5 ${meta.color}`} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{meta.description}</p>
              </div>
            );
          })}
        </div>

        {/* Members List */}
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-primary" />
                Organization Members
              </p>
              <h2 className="text-lg font-semibold text-foreground mt-1">
                {members.length} member{members.length !== 1 ? "s" : ""}
              </h2>
            </div>
            {myRole && (
              <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(myRole)}`}>
                YOUR ROLE: {myRole.toUpperCase()}
              </span>
            )}
          </div>

          <div className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading team members...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
                No team members found. Your organization will be set up automatically.
              </p>
            ) : members.map((member) => {
              const meta = ROLE_META[member.role];
              const Icon = meta.icon;
              const isMe = member.user_id === user?.id;

              return (
                <div key={member.id} className="rounded-lg border border-border bg-muted/30 p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${meta.color}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {isMe ? "You" : member.email || `User ${member.user_id.slice(0, 8)}...`}
                        </p>
                        {isMe && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                            YOU
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Joined {new Date(member.joined_at).toLocaleDateString()} · ID: {member.user_id.slice(0, 12)}...
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-mono px-2 py-1 rounded border ${badgeClass(member.role)}`}>
                      {member.role.toUpperCase()}
                    </span>

                    {canManage && !isMe && member.role !== "owner" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingMember(member);
                            setNewRole(member.role);
                          }}
                        >
                          <ChevronDown className="w-3.5 h-3.5 mr-1" />
                          Role
                        </Button>
                        {isOwner && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveMember(member)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Org-Level Credential Access */}
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground tracking-widest uppercase flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-primary" />
              Credential Access Policy
            </p>
            <h2 className="text-lg font-semibold text-foreground mt-1">Organization-level AWS access</h2>
            <p className="text-sm text-muted-foreground mt-1">
              AWS credentials stored with an <code className="text-[11px] bg-muted px-1 py-0.5 rounded">org_id</code> are accessible to all members of this organization, governed by RLS policies.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-foreground">Owner / Admin</p>
              <ul className="text-[11px] text-muted-foreground space-y-1">
                <li>• Store and manage org-level AWS credentials</li>
                <li>• Enable/disable Guardian for org credentials</li>
                <li>• View all audit logs across the organization</li>
                <li>• Invite and remove team members</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-foreground">Member / Viewer</p>
              <ul className="text-[11px] text-muted-foreground space-y-1">
                <li>• Use org-level credentials for agent queries</li>
                <li>• View reports generated with org credentials</li>
                <li>• Members can manage their own personal credentials</li>
                <li>• Viewers have read-only access to dashboards</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join <strong>{org?.name}</strong>. The user must have a CloudPilot account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email Address</label>
              <Input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Role</label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — Manage members and credentials</SelectItem>
                  <SelectItem value="member">Member — Use agent and manage own credentials</SelectItem>
                  <SelectItem value="viewer">Viewer — Read-only access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Cancel</Button>
            <Button variant="terminal" onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
              {inviting ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role Edit Dialog */}
      <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Member Role</DialogTitle>
            <DialogDescription>
              Update the role for user {editingMember?.user_id.slice(0, 12)}...
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={newRole} onValueChange={(v) => setNewRole(v as AppRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-2">
              {ROLE_META[newRole].description}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button>
            <Button variant="terminal" onClick={handleRoleChange}>Update Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Team;
