// Revokes Apple Development certificates that CI runners create (#77).
// Each fresh macOS runner makes Xcode create a new development certificate via the
// App Store Connect API key; Apple caps how many may exist. Only certificates whose
// name says "Created via API" are touched; personal certificates are left alone.
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH. No dependencies (Node 22).
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env;
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" });
const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
const key = createPrivateKey(readFileSync(ASC_KEY_PATH));
const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
const auth = { Authorization: `Bearer ${head}.${body}.${sig.toString("base64url")}` };
const api = "https://api.appstoreconnect.apple.com/v1/certificates";

const res = await fetch(`${api}?filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT&limit=200`, { headers: auth });
if (!res.ok) {
  console.log(`::warning::certificate list failed: HTTP ${res.status}`);
  process.exit(0);
}
const certs = (await res.json()).data ?? [];
console.log(`Development certificates: ${certs.length}`);
for (const c of certs) {
  const name = `${c.attributes.name ?? ""} | ${c.attributes.displayName ?? ""}`;
  const ci = /created via api/i.test(name);
  console.log(`- ${name} (expires ${c.attributes.expirationDate?.slice(0, 10)})${ci ? " → revoke" : ""}`);
  if (!ci) continue;
  const del = await fetch(`${api}/${c.id}`, { method: "DELETE", headers: auth });
  console.log(`  revoke: HTTP ${del.status}`);
}
