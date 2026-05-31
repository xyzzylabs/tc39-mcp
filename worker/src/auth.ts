// Sponsor authentication middleware.
//
// MCP traffic carries an optional `Authorization: Bearer tcms_…`
// header. When present and the SHA-256 of the key is found in the
// SPONSORS KV namespace, the request is treated as a sponsor call:
// it gets routed to a more generous rate limiter and bucketed per
// key (not per IP) so the same key can be used from multiple
// machines without those machines fighting each other for budget.
//
// Anonymous traffic — no header, malformed header, or unrecognized
// key — falls through to the existing IP-bucketed free-tier path.
//
// No raw key ever lives in KV: we store sha256(key) → metadata,
// and the runtime hash check is the only thing that distinguishes
// valid keys from invalid ones. A leaked KV dump cannot be replayed.

/** Bearer-token grammar. The `tcms_` prefix is identifiable in
 *  logs and grep, mirroring the convention used by Stripe
 *  (`sk_live_…`) and GitHub (`ghp_…`). Suffix is the URL-safe
 *  base64 of 32 random bytes ⇒ 43 chars. We accept 32+ characters
 *  to leave room for future formats. */
const BEARER_RE = /^Bearer\s+(tcms_[A-Za-z0-9_-]{32,})$/;

/** Per-sponsor record persisted in KV. Hand-written by the issuance
 *  script (`worker/scripts/issue-sponsor-key.ts`). */
export interface SponsorMetadata {
  /** GitHub login of the sponsor — only used for the maintainer's
   *  own bookkeeping and for the structured log line. Never echoed
   *  back to the client. */
  github_login: string;
  /** Tier name. Single-tier today; reserved for future expansion. */
  tier: "sponsor";
  /** ISO date (YYYY-MM-DD) the key was issued. */
  since: string;
  /** Monthly sponsorship amount in USD, if the maintainer chose to
   *  record it. Cosmetic only — rate-limit behavior is determined
   *  by `tier`, not amount. */
  amount_per_month_usd?: number;
}

/** Result of the auth check, consumed by the request handler in
 *  `index.ts`. The handler picks which rate-limiter binding to call
 *  based on `plan`, buckets it under `rateLimitKey`, and logs
 *  `apiKeyHash` alongside the per-request line so the maintainer
 *  can correlate sponsor usage without ever knowing the raw key. */
export interface AuthResult {
  plan: "free" | "sponsor";
  rateLimitKey: string;
  apiKeyHash?: string;
  sponsor?: SponsorMetadata;
}

/** SHA-256 → lowercase hex. Used both at runtime (incoming Bearer
 *  → KV key) and offline (issuance script computes the same hash to
 *  decide what KV key to write). */
export async function sha256hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Environment slot. Bound from `worker/wrangler.toml`'s
 *  `[[kv_namespaces]]` block. Optional so unit tests + local
 *  `wrangler dev` runs work without provisioning the KV. */
export interface AuthEnv {
  SPONSORS?: KVNamespace;
}

/** Resolve the request's plan. Never throws — every failure mode
 *  (missing header, malformed header, KV miss, KV outage) returns
 *  `{ plan: "free", rateLimitKey: <fallbackIp> }` so anonymous
 *  traffic is the safe default. */
export async function authenticate(
  request: Request,
  env: AuthEnv,
  fallbackIp: string,
): Promise<AuthResult> {
  const header = request.headers.get("authorization");
  if (!header) return { plan: "free", rateLimitKey: fallbackIp };

  const match = BEARER_RE.exec(header);
  if (!match || !env.SPONSORS) {
    return { plan: "free", rateLimitKey: fallbackIp };
  }

  const apiKey = match[1]!;
  const hash = await sha256hex(apiKey);

  let meta: SponsorMetadata | null;
  try {
    meta = await env.SPONSORS.get<SponsorMetadata>(hash, "json");
  } catch {
    // KV transient error: fall back to anonymous so we don't block
    // any traffic. The sponsor's key works again as soon as KV
    // recovers.
    return { plan: "free", rateLimitKey: fallbackIp };
  }
  if (!meta) {
    // Key syntax was valid but doesn't match any sponsor record.
    // Treat as anonymous; the request still goes through, just at
    // the lower rate limit.
    return { plan: "free", rateLimitKey: fallbackIp };
  }

  return {
    plan: "sponsor",
    rateLimitKey: `sponsor:${hash}`,
    apiKeyHash: hash,
    sponsor: meta,
  };
}
