import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  Deno.env.get("ALLOWED_ORIGIN") || "http://localhost:8080",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Caller client — to verify the JWT and get the caller's identity
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service role client — to look up users by email and insert org_members
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { action } = body;

    if (action === "invite") {
      const { email, role, org_id } = body;

      // Validate inputs
      if (!email || !role || !org_id) {
        return new Response(
          JSON.stringify({ error: "email, role, and org_id are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validRoles = ["admin", "member", "viewer"];
      if (!validRoles.includes(role)) {
        return new Response(
          JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check the caller has permission (owner or admin of this org)
      const { data: callerMembership } = await adminClient
        .from("org_members")
        .select("role")
        .eq("org_id", org_id)
        .eq("user_id", caller.id)
        .single();

      if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) {
        return new Response(
          JSON.stringify({ error: "You must be an owner or admin to invite members" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Look up the target user by email using the admin API
      const { data: { users }, error: lookupError } = await adminClient.auth.admin.listUsers();
      if (lookupError) {
        return new Response(
          JSON.stringify({ error: "Failed to look up users" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let targetUser = users.find(
        (u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (!targetUser) {
        // Invite the user via Supabase Auth Admin API
        const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);

        if (inviteError || !inviteData.user) {
          return new Response(
            JSON.stringify({ error: `Failed to invite user: ${inviteError?.message || 'Unknown error'}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        targetUser = inviteData.user;
      }

      // Check if already a member
      const { data: existing } = await adminClient
        .from("org_members")
        .select("id")
        .eq("org_id", org_id)
        .eq("user_id", targetUser.id)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "This user is already a member of your organization" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert org membership
      const { data: membership, error: insertError } = await adminClient
        .from("org_members")
        .insert({
          org_id,
          user_id: targetUser.id,
          role,
          invited_by: caller.id,
        })
        .select()
        .single();

      if (insertError) {
        return new Response(
          JSON.stringify({ error: `Failed to add member: ${insertError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          member: {
            id: membership.id,
            user_id: targetUser.id,
            email: targetUser.email,
            role,
            joined_at: membership.joined_at,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list_members_with_emails") {
      const { org_id } = body;
      if (!org_id) {
        return new Response(
          JSON.stringify({ error: "org_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify caller is a member
      const { data: callerMembership } = await adminClient
        .from("org_members")
        .select("role")
        .eq("org_id", org_id)
        .eq("user_id", caller.id)
        .single();

      if (!callerMembership) {
        return new Response(
          JSON.stringify({ error: "You are not a member of this organization" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get all members
      const { data: members } = await adminClient
        .from("org_members")
        .select("*")
        .eq("org_id", org_id)
        .order("joined_at", { ascending: true });

      if (!members || members.length === 0) {
        return new Response(
          JSON.stringify({ members: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Resolve emails from auth.users
      const { data: { users: allUsers } } = await adminClient.auth.admin.listUsers();
      const userMap = new Map<string, string>();
      if (allUsers) {
        for (const u of allUsers) {
          if (u.email) userMap.set(u.id, u.email);
        }
      }

      const enriched = members.map((m: { id: string; user_id: string; role: string; joined_at: string; invited_by: string | null }) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        invited_by: m.invited_by,
        email: userMap.get(m.user_id) || null,
      }));

      return new Response(
        JSON.stringify({ members: enriched }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Supported: invite, list_members_with_emails` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
