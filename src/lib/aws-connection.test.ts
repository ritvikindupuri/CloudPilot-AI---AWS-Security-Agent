import { describe, it, expect, beforeEach } from "vitest";
import { stripAwsSecrets, loadStoredAwsConnection } from "./aws-connection";

describe("stripAwsSecrets", () => {
  it("removes session credentials and nested secrets", () => {
    const cleaned = stripAwsSecrets({
      method: "assume_role",
      region: "us-east-1",
      accessKeyId: "AKIASECRET",
      secretAccessKey: "secret",
      session: {
        accessKeyId: "ASIASECRET",
        secretAccessKey: "nested",
        sessionToken: "token",
      },
      identity: { account: "123456789012", arn: "arn:aws:iam::123:role/x" },
    });
    expect(cleaned?.method).toBe("assume_role");
    expect(cleaned?.identity).toEqual({ account: "123456789012", arn: "arn:aws:iam::123:role/x" });
    expect(cleaned).not.toHaveProperty("accessKeyId");
    expect(cleaned).not.toHaveProperty("secretAccessKey");
    expect(cleaned).not.toHaveProperty("session");
  });
});

describe("loadStoredAwsConnection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("scrubs secrets persisted from older clients", () => {
    localStorage.setItem(
      "cloudpilot-aws-credentials",
      JSON.stringify({
        method: "access_key",
        region: "us-west-2",
        session: { accessKeyId: "ASIA", secretAccessKey: "x", sessionToken: "y" },
        identity: { account: "1", arn: "arn" },
      }),
    );
    const loaded = loadStoredAwsConnection();
    expect(loaded?.region).toBe("us-west-2");
    expect(loaded).not.toHaveProperty("session");
    const persisted = JSON.parse(localStorage.getItem("cloudpilot-aws-credentials") || "{}");
    expect(persisted.session).toBeUndefined();
    expect(persisted.accessKeyId).toBeUndefined();
  });
});
