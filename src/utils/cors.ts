/**
 * CORS allow-list matcher with wildcard support.
 *
 * `CORS_ORIGIN` env var is a comma-separated list of origins. Each
 * entry can be an exact origin string (`https://example.com`) or a
 * glob (`https://app-*.vercel.app`) — useful for matching the random
 * preview-deploy URLs that Vercel / Netlify / Cloudflare Pages mint
 * per commit.
 *
 * `*` matches anything that isn't `/`, so a single rule stays scoped
 * to the host portion of the URL.
 */

export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export type CorsConfig = {
  allowedOrigins: string[];
  allowAllOrigins: boolean;
  matchesAllowed: (origin: string) => boolean;
};

function compileMatcher(origin: string): (candidate: string) => boolean {
  if (!origin.includes("*")) {
    return (candidate) => candidate === origin;
  }
  const pattern = origin
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  const re = new RegExp(`^${pattern}$`);
  return (candidate) => re.test(candidate);
}

export function buildCorsConfig(corsOriginEnv: string): CorsConfig {
  const allowedOrigins = corsOriginEnv
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);

  const allowAllOrigins = allowedOrigins.includes("*");
  const matchers = allowedOrigins.map(compileMatcher);

  return {
    allowedOrigins,
    allowAllOrigins,
    matchesAllowed: (origin) => matchers.some((m) => m(origin)),
  };
}
