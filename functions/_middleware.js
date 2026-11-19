// Gate for every request to the ledger site. Fails closed.
//
// Cloudflare Access authenticates the visitor at the edge and attaches a signed
// token in the Cf-Access-Jwt-Assertion header. This middleware verifies that
// token itself, so a request that did not come through Access (for example on a
// *.pages.dev preview address that has no Access policy) gets nothing.
//
// Required environment variables (Pages > Settings > Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  e.g. https://your-team.cloudflareaccess.com
//   ACCESS_AUD          the Application Audience (AUD) tag of the Access application
// Optional:
//   ALLOWED_EMAILS      comma-separated list; when set, only these addresses pass

let certCache = { team: null, keys: null, at: 0 };
const CERT_TTL_MS = 10 * 60 * 1000;

function deny(status, message) {
  return new Response(message + "\n", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function getKeys(team, force) {
  const fresh = certCache.team === team && certCache.keys && Date.now() - certCache.at < CERT_TTL_MS;
  if (fresh && !force) return certCache.keys;
  const res = await fetch(team + "/cdn-cgi/access/certs");
  if (!res.ok) throw new Error("could not load Access signing keys");
  const body = await res.json();
  certCache = { team, keys: body.keys || [], at: Date.now() };
  return certCache.keys;
}

export async function verifyAccessToken(token, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN).replace(/\/+$/, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  let jwk = (await getKeys(team, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), signed);
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  if (payload.iss !== team) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  return payload;
}

export async function onRequest(context) {
  const { request, env, next } = context;

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return deny(403, "This site is gated and the gate is not configured. Nothing is served until it is.");
  }
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/?$/i.test(String(env.ACCESS_TEAM_DOMAIN))) {
    return deny(403, "This site is gated and the gate is misconfigured.");
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return deny(403, "Access required.");

  let payload;
  try {
    payload = await verifyAccessToken(token, env);
  } catch {
    return deny(403, "Access could not be verified.");
  }
  if (!payload) return deny(403, "Access required.");

  if (env.ALLOWED_EMAILS) {
    const allowed = String(env.ALLOWED_EMAILS).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const email = String(payload.email || "").toLowerCase();
    if (!email || !allowed.includes(email)) return deny(403, "This account is not authorized for this site.");
  }

  return next();
}
