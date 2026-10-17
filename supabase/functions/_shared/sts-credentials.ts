/**
 * Server-side STS AssumeRole with a per-customer ExternalId.
 * Session credentials never leave the server.
 */

import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "https://esm.sh/@aws-sdk/client-sts@3.744.0";

const ROLE_ARN_RE = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;
const REGION_RE = /^[a-z]{2}(-[a-z]+-\d+)?$/;

export function generateExternalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function platformStsClient(region: string): STSClient {
  const accessKeyId = Deno.env.get("CLOUDPILOT_AWS_ACCESS_KEY_ID") || Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("CLOUDPILOT_AWS_SECRET_ACCESS_KEY") || Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const sessionToken = Deno.env.get("CLOUDPILOT_AWS_SESSION_TOKEN") || Deno.env.get("AWS_SESSION_TOKEN");
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Platform AWS credentials are not configured for AssumeRole");
  }
  return new STSClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });
}

export interface AssumedSession {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
  region: string;
  identity: { account: string; arn: string; userId: string };
}

export async function assumeCustomerRole(opts: {
  roleArn: string;
  externalId: string;
  region: string;
  sessionName?: string;
}): Promise<AssumedSession> {
  const roleArn = opts.roleArn.trim();
  const region = opts.region.trim();
  if (!ROLE_ARN_RE.test(roleArn)) throw new Error("Invalid role ARN");
  if (!REGION_RE.test(region)) throw new Error("Invalid AWS region");
  if (!opts.externalId || opts.externalId.length < 16) throw new Error("Invalid ExternalId");

  const sts = platformStsClient(region);
  const assumed = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: (opts.sessionName || `CloudPilot-${Date.now()}`).slice(0, 64),
    DurationSeconds: 3600,
    ExternalId: opts.externalId,
  }));

  const creds = assumed.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken || !creds.Expiration) {
    throw new Error("AssumeRole returned incomplete credentials");
  }

  const assumedSts = new STSClient({
    region,
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    },
  });
  const identity = await assumedSts.send(new GetCallerIdentityCommand({}));

  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
    expiration: creds.Expiration.toISOString(),
    region,
    identity: {
      account: identity.Account || "",
      arn: identity.Arn || "",
      userId: identity.UserId || "",
    },
  };
}

export function awsConfigFromSession(session: AssumedSession) {
  return {
    region: session.region,
    credentials: {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      sessionToken: session.sessionToken,
    },
  };
}
