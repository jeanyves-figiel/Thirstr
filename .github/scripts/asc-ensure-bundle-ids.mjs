// Registers app-extension bundle IDs in the Apple Developer account before signing (#119).
// Xcode automatic signing (-allowProvisioningUpdates) makes profiles but cannot register a new
// bundle ID, so the first build with a new extension failed at export. Idempotent: existing IDs
// are left alone. Usage: node asc-ensure-bundle-ids.mjs <id>=<name> ...
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
const auth = { Authorization: `Bearer ${head}.${body}.${sig.toString("base64url")}`, "Content-Type": "application/json" };
const api = "https://api.appstoreconnect.apple.com/v1/bundleIds";

let failed = false;
for (const arg of process.argv.slice(2)) {
  const [identifier, name = identifier] = arg.split("=");
  const list = await fetch(`${api}?filter[identifier]=${encodeURIComponent(identifier)}&limit=20`, { headers: auth });
  if (!list.ok) {
    console.log(`::error::bundle ID lookup ${identifier}: HTTP ${list.status} ${await list.text()}`);
    failed = true;
    continue;
  }
  // filter[identifier] is a prefix match: compare exactly.
  const found = ((await list.json()).data ?? []).some((b) => b.attributes?.identifier === identifier);
  if (found) {
    console.log(`${identifier}: registered`);
    continue;
  }
  const res = await fetch(api, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ data: { type: "bundleIds", attributes: { identifier, name: name.replace(/[^A-Za-z0-9 ]/g, " "), platform: "IOS" } } }),
  });
  if (res.ok || res.status === 409) console.log(`${identifier}: created (HTTP ${res.status})`);
  else {
    console.log(`::error::bundle ID create ${identifier}: HTTP ${res.status} ${await res.text()}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
