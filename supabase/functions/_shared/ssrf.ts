/**
 * Outbound URL checks for user-configured webhooks.
 * HTTPS only, no redirects, block private/link-local/metadata addresses
 * including after DNS resolution.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
]);

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function inCidr(ip: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const baseInt = ipv4ToInt(base);
  if (baseInt === null || Number.isNaN(bits)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

export function isPrivateOrReservedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const cidrs = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
  ];
  return cidrs.some((c) => inCidr(n, c));
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fec0:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f:]+)$/);
  if (mappedHex) return true;
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".internal") || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "169.254.169.254") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateOrReservedIPv4(host)) return true;
  // Dword / hex / octal IPv4 forms (e.g. 2130706433, 0x7f000001)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (host.includes(":") && isPrivateOrReservedIPv6(host)) return true;
  return false;
}

export function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use https");
  }
  if (url.username || url.password) {
    throw new Error("Webhook URL must not include credentials");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("Webhook URL target is not allowed");
  }
  return url;
}

export async function resolveAndAssertPublicHttps(
  raw: string,
  resolveDns: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<URL> {
  const url = parseHttpsUrl(raw);
  const records = await resolveDns(url.hostname);
  if (!records.length) {
    throw new Error("Webhook URL could not be resolved");
  }
  for (const addr of records) {
    if (addr.includes(":")) {
      if (isPrivateOrReservedIPv6(addr)) {
        throw new Error("Webhook URL resolves to a private address");
      }
    } else {
      if (ipv4ToInt(addr) === null || isPrivateOrReservedIPv4(addr)) {
        throw new Error("Webhook URL resolves to a private address");
      }
    }
  }
  return url;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  if (isPrivateOrReservedIPv4(hostname) || (hostname.includes(":") && isPrivateOrReservedIPv6(hostname))) {
    return [hostname];
  }
  const out: string[] = [];
  try {
    const a = await Deno.resolveDns(hostname, "A");
    out.push(...a);
  } catch {
    // ignore missing A
  }
  try {
    const aaaa = await Deno.resolveDns(hostname, "AAAA");
    out.push(...aaaa);
  } catch {
    // ignore missing AAAA
  }
  return out;
}

export async function safeWebhookFetch(
  rawUrl: string,
  init: RequestInit,
): Promise<Response> {
  const url = await resolveAndAssertPublicHttps(rawUrl);
  return await fetch(url.toString(), {
    ...init,
    redirect: "error",
  });
}
