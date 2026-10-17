import { describe, it, expect, beforeEach } from "vitest";
import {
  toPublicAwsConnection,
  loadStoredAwsConnection,
  persistPublicAwsConnection,
  clearStoredAwsConnection,
} from "./aws-connection";

describe("toPublicAwsConnection", () => {
  it("keeps only allowlisted connection metadata", () => {
    const cleaned = toPublicAwsConnection({
      method: "assume_role",
      region: "us-east-1",
      credentialId: "11111111-1111-4111-8111-111111111111",
      accessKeyId: "AKIASECRET",
      secretAccessKey: "secret",
      session: {
        accessKeyId: "ASIASECRET",
        secretAccessKey: "nested",
        sessionToken: "token",
      },
      identity: { account: "123456789012", arn: "arn:aws:iam::123:role/x" },
      externalId: "should-not-persist",
      connected: true,
    });
    expect(cleaned).toEqual({
      method: "assume_role",
      region: "us-east-1",
      credentialId: "11111111-1111-4111-8111-111111111111",
      connected: true,
    });
  });
});

describe("loadStoredAwsConnection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("migrates legacy storage and never writes secrets back", () => {
    localStorage.setItem(
      "cloudpilot-aws-credentials",
      JSON.stringify({
        method: "access_key",
        region: "us-west-2",
        session: { accessKeyId: "ASIA", secretAccessKey: "x", sessionToken: "y" },
        identity: { account: "1", arn: "arn" },
        connected: true,
      }),
    );
    const loaded = loadStoredAwsConnection();
    expect(loaded).toEqual({
      method: "access_key",
      region: "us-west-2",
      connected: true,
    });
    expect(localStorage.getItem("cloudpilot-aws-credentials")).toBeNull();
    const persisted = JSON.parse(localStorage.getItem("cloudpilot-aws-connection") || "{}");
    expect(persisted.session).toBeUndefined();
    expect(persisted.accessKeyId).toBeUndefined();
    expect(persisted.identity).toBeUndefined();
  });

  it("persistPublicAwsConnection writes only allowlisted fields", () => {
    persistPublicAwsConnection({
      method: "assume_role",
      region: "eu-west-1",
      credentialId: "22222222-2222-4222-8222-222222222222",
      secretAccessKey: "nope",
      connected: true,
    });
    const persisted = JSON.parse(localStorage.getItem("cloudpilot-aws-connection") || "{}");
    expect(persisted).toEqual({
      method: "assume_role",
      region: "eu-west-1",
      credentialId: "22222222-2222-4222-8222-222222222222",
      connected: true,
    });
    clearStoredAwsConnection();
    expect(localStorage.getItem("cloudpilot-aws-connection")).toBeNull();
  });
});
