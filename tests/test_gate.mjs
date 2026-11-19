// Tests for functions/_middleware.js and site/verify.js. Run: node tests/test_gate.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/_middleware.js";

const require = createRequire(import.meta.url);
const TEAM = "https://example-team.cloudflareaccess.com";
const AUD = "aud-tag-for-tests";
let failures = 0;
const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failures++; };

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

let certFetches = 0;
globalThis.fetch = async (url) => {
  certFetches++;
  if (String(url) !== TEAM + "/cdn-cgi/access/certs") return new Response("no", { status: 404 });
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
};

async function token(claims, { key = pair.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: TEAM, aud: [AUD], exp: now + 300, iat: now, email: "smash@example.com", ...claims }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body));
  return head + "." + body + "." + b64url(sig);
}

async function run(tok, env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }) {
  const headers = tok ? { "cf-access-jwt-assertion": tok } : {};
  const res = await onRequest({
    request: new Request("https://ledger.example/demo/", { headers }), env,
    next: async () => new Response("LEDGER", { status: 200 }),
  });
  return [res.status, await res.text()];
}

const now = Math.floor(Date.now() / 1000);
check("valid token is served", (await run(await token({})))[0] === 200);
check("no token is refused", (await run(null))[0] === 403);
check("gate not configured is refused", (await run(await token({}), {}))[0] === 403);
check("team domain that is not an Access domain is refused", (await run(await token({}), { ACCESS_TEAM_DOMAIN: "https://evil.example", ACCESS_AUD: AUD }))[0] === 403);
check("expired token is refused", (await run(await token({ exp: now - 10 })))[0] === 403);
check("wrong audience is refused", (await run(await token({ aud: ["something-else"] })))[0] === 403);
check("wrong issuer is refused", (await run(await token({ iss: "https://other.cloudflareaccess.com" })))[0] === 403);
check("token signed by another key is refused", (await run(await token({}, { key: other.privateKey })))[0] === 403);
check("unknown key id is refused", (await run(await token({}, { kid: "nope" })))[0] === 403);
check("alg none is refused", (await run(await token({}, { alg: "none" })))[0] === 403);
const good = await token({});
const tampered = good.split(".").map((p, i) => (i === 1 ? b64url(JSON.stringify({ iss: TEAM, aud: [AUD], exp: now + 300, email: "attacker@example.com" })) : p)).join(".");
check("tampered payload is refused", (await run(tampered))[0] === 403);
check("garbage token is refused", (await run("not.a.token"))[0] === 403);
check("refusal body leaks no ledger content", !(await run(null))[1].includes("LEDGER"));
const envList = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: "Smash@Example.com, second@example.com" };
check("allowed email passes the list", (await run(await token({}), envList))[0] === 200);
check("email not on the list is refused", (await run(await token({ email: "someone@example.com" }), envList))[0] === 403);
check("token with no email is refused when a list is set", (await run(await token({ email: undefined }), envList))[0] === 403);
check("signing keys are cached between requests", certFetches <= 4);

// Browser hash must equal the Python hash for every ledger in the repo.
const { ledgerHash } = require("../site/verify.js");
const { readdirSync } = await import("node:fs");
for (const slug of readdirSync(new URL("../ledgers/", import.meta.url))) {
  const path = new URL(`../ledgers/${slug}/ledger.json`, import.meta.url).pathname;
  const py = execFileSync("python3", [new URL("../tools/pencil_ledger.py", import.meta.url).pathname, "hash", path]).toString().trim();
  const js = await ledgerHash(JSON.parse(readFileSync(path, "utf8")));
  check(`browser hash equals script hash: ${slug}`, py === js);
}

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
