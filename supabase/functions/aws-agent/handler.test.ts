import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-role-key");
Deno.env.set("SUPABASE_ANON_KEY", "unit-test-anon-key");
Deno.env.set("ALLOWED_ORIGINS", "https://app.example.com");

const { handler } = await import("./index.ts");

Deno.test("C1 handler: POST without Authorization is 401", async () => {
  const res = await handler(new Request("https://example.test/functions/v1/aws-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ action: "list_pending_actions" }),
  }));
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  const body = await res.json();
  assertEquals(typeof body.error, "string");
});

Deno.test("C1 handler: health GET remains unauthenticated", async () => {
  const res = await handler(new Request("https://example.test/functions/v1/aws-agent/health", {
    method: "GET",
  }));
  assertEquals(res.status, 200);
});
