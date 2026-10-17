import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler } from "./index.ts";

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://example.test${path}`, init);
}

Deno.test("C2 handler: missing service-role bearer is 401", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-role-key");
  const res = await handler(req("/functions/v1/aws-executor", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ service: "IAM", commandName: "ListUsersCommand", params: {} }),
  }));
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("C2 handler: blocked privilege-escalation command is 403 even with service role", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-role-key");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  const res = await handler(req("/functions/v1/aws-executor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer unit-test-service-role-key",
    },
    body: JSON.stringify({ service: "IAM", commandName: "CreateAccessKeyCommand", params: { UserName: "root" } }),
  }));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(typeof body.error, "string");
  assertEquals(body.error.includes("CreateAccessKey"), false);
});

Deno.test("C2 handler: write without approval is 403", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-role-key");
  const res = await handler(req("/functions/v1/aws-executor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer unit-test-service-role-key",
    },
    body: JSON.stringify({
      service: "EC2",
      commandName: "AuthorizeSecurityGroupIngressCommand",
      params: { GroupId: "sg-1" },
    }),
  }));
  assertEquals(res.status, 403);
});
