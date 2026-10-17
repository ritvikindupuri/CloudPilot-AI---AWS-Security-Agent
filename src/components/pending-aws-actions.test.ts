import { describe, expect, it } from "vitest";

function prettyParams(params: unknown): string {
  try {
    return JSON.stringify(params ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

describe("pending AWS approval cards", () => {
  it("pretty-prints full parameters including CIDR and ports", () => {
    const rendered = prettyParams({
      GroupId: "sg-1",
      IpPermissions: [{ IpProtocol: "tcp", FromPort: 0, ToPort: 65535, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }],
    });
    expect(rendered).toContain("0.0.0.0/0");
    expect(rendered).toContain("65535");
    expect(rendered).toContain("sg-1");
  });
});
