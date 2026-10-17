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

function expandIPv6(ip: string): bigint | null {
  let raw = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!raw.includes(":")) return null;

  const dotted = raw.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    raw = `${dotted[1]}${hi}:${lo}`;
  }

  const sides = raw.split("::");
  if (sides.length > 2) return null;
  let groups: string[];
  if (sides.length === 2) {
    const left = sides[0] ? sides[0].split(":") : [];
    const right = sides[1] ? sides[1].split(":") : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill("0"), ...right];
  } else {
    groups = raw.split(":");
  }
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!g) return null;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

function ipv6InPrefix(ip: bigint, prefixHex: string, bits: number): boolean {
  const prefix = BigInt("0x" + prefixHex.padEnd(32, "0"));
  const shift = BigInt(128 - bits);
  return (ip >> shift) === (prefix >> shift);
}

function embeddedIPv4(ip: bigint, bitsFromRight = 32): string {
  const mask = (1n << BigInt(bitsFromRight)) - 1n;
  const v = Number(ip & mask);
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join(".");
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const n = expandIPv6(ip);
  if (n === null) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::" || lower === "::1") return true;
    return false;
  }

  // ::/128 unspecified, ::1/128 loopback
  if (n === 0n || n === 1n) return true;
  // fe80::/10 link-local
  if (ipv6InPrefix(n, "fe80", 10)) return true;
  // fec0::/10 site-local (deprecated)
  if (ipv6InPrefix(n, "fec0", 10)) return true;
  // fc00::/7 unique local
  if (ipv6InPrefix(n, "fc00", 7)) return true;
  // ff00::/8 multicast
  if (ipv6InPrefix(n, "ff00", 8)) return true;
  // 2001:db8::/32 documentation
  if (ipv6InPrefix(n, "20010db8", 32)) return true;
  // 2002::/16 6to4 (embeds IPv4)
  if (ipv6InPrefix(n, "2002", 16)) return true;
  // 64:ff9b::/96 NAT64 well-known prefix
  if (ipv6InPrefix(n, "0064ff9b", 96)) return true;
  // ::ffff:0:0/96 IPv4-mapped
  if (ipv6InPrefix(n, "00000000000000000000ffff", 96)) {
    return isPrivateOrReservedIPv4(embeddedIPv4(n));
  }
  // ::/96 IPv4-compatible (deprecated) — ::a.b.c.d
  if (ipv6InPrefix(n, "000000000000000000000000", 96) && n > 1n) {
    return isPrivateOrReservedIPv4(embeddedIPv4(n));
  }
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
    if (addr.includes(":") || addr.includes("::")) {
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
