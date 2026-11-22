#!/usr/bin/env node
// Builds the static marketing site (docs/spec/website.md, W-01) into web/site/dist.
// No dependencies: node web/site/build.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "dist"));
const LANGS = ["en", "fr", "de"];
const CANON = "https://thirstr.fun";
const EMAIL = "hello@thirstr.fun";
// Operator details for the legal notice (#62). Page + footer link only when present.
const legalPath = join(here, "legal.json");
const LEGAL = existsSync(legalPath) ? JSON.parse(readFileSync(legalPath, "utf8")) : null;
const S = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(here, "strings", `${l}.json`), "utf8"))]));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const prefix = (l) => (l === "en" ? "/" : `/${l}/`);
const logo = (l) =>
  `<a class="logo" href="${prefix(l)}" aria-label="Thirstr">thirst<span class="r">r</span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></a>`;

function page(l, sub, title, desc, body, { noindex = false } = {}) {
  const t = S[l];
  const alt = LANGS.map((x) => `<link rel="alternate" hreflang="${x}" href="${CANON}${prefix(x)}${sub}">`).join("\n");
  const langs = LANGS.map(
    (x) => `<a href="${prefix(x)}${sub}" hreflang="${x}" lang="${x}"${x === l ? ' aria-current="page"' : ""}>${x.toUpperCase()}</a>`
  ).join("");
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#17142E">
<meta name="referrer" content="no-referrer">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${CANON}${prefix(l)}${sub}">\n${alt}\n<link rel="alternate" hreflang="x-default" href="${CANON}/${sub}">`}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/bricolage-grotesque-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${CANON}${prefix(l)}${sub}">
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<div class="wrap">
<header class="top">${logo(l)}<nav class="langs" aria-label="${esc(t.lang_label)}">${langs}</nav></header>
<main id="main">
${body}
</main>
<footer><span>© ${new Date().getUTCFullYear()} Thirstr</span><a href="${prefix(l)}privacy/">${esc(t.footer_privacy)}</a>${LEGAL ? `<a href="${prefix(l)}legal/">${esc(t.footer_legal)}</a>` : ""}<a href="mailto:${EMAIL}">${EMAIL}</a><span>${esc(t.footer_age)}</span></footer>
</div>
</body>
</html>
`;
}

function home(l) {
  const t = S[l];
  const store = (name) => `<span class="store">${esc(name)} <small>${esc(t.store_soon)}</small></span>`;
  const level = (k, def) =>
    `<div class="level${def ? " default" : ""}"><h3>${esc(t[`loc_${k}`])}</h3><p>${esc(t[`loc_${k}_text`])}</p></div>`;
  const mode = (k) => `<div class="mode m-${k}"><h3>${esc(t[`mode_${k}`])}</h3><p>${esc(t[`mode_${k}_text`])}</p></div>`;
  const body = `<div class="hero">
<span class="kicker">${esc(t.hero_kicker)}</span>
<h1>${t.hero_title}</h1>
<p class="sub">${esc(t.hero_sub)}</p>
<div class="stores">${store(t.store_ios)}${store(t.store_android)}</div>
<p class="beta">${esc(t.beta)}</p>
</div>
<section aria-labelledby="modes"><h2 id="modes">${esc(t.modes_title)}</h2>
<div class="modes">${mode("hookup")}${mode("friends")}${mode("sport")}</div></section>
<section aria-labelledby="loc"><h2 id="loc">${esc(t.loc_title)}</h2><p class="lead">${esc(t.loc_sub)}</p>
<div class="levels">${level("hidden")}${level("city")}${level("area", true)}${level("exact")}</div></section>
<section aria-labelledby="priv"><h2 id="priv">${esc(t.priv_title)}</h2>
<ul class="promises">${[1, 2, 3, 4, 5].map((i) => `<li>${esc(t[`priv_${i}`])}</li>`).join("")}</ul>
<a class="btn" href="${prefix(l)}privacy/">${esc(t.priv_more)}</a></section>
<section class="duo"><div class="card personal"><h2>${esc(t.free_title)}</h2><p>${esc(t.free_text)}</p></div>
<div class="card friends"><h2>${esc(t.all_title)}</h2><p>${esc(t.all_text)}</p></div></section>
<section class="contact" aria-labelledby="contact"><div><h2 id="contact">${esc(t.contact_title)}</h2><p>${esc(t.contact_text)}</p></div>
<a class="btn coral" href="mailto:${EMAIL}">${EMAIL}</a></section>`;
  return page(l, "", t.title, t.description, body);
}

function privacy(l) {
  const t = S[l];
  const secs = t.privacy_sections.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("\n");
  const body = `<article class="doc"><h1>${esc(t.privacy_page_title)}</h1><p class="intro">${esc(t.privacy_intro)}</p>
${secs}
<p class="back"><a class="btn" href="${prefix(l)}">${esc(t.back_home)}</a></p></article>`;
  return page(l, "privacy/", `${t.privacy_page_title} · Thirstr`, t.privacy_intro, body);
}

function legal(l) {
  const t = S[l];
  const L = LEGAL;
  const country = typeof L.country === "object" ? L.country[l] ?? L.country.en : L.country;
  const addr = [L.name, ...L.address, country].map(esc).join("<br>");
  const email = L.email ?? EMAIL;
  const body = `<article class="doc"><h1>${esc(t.legal_page_title)}</h1>
<h2>${esc(t.legal_operator)}</h2><p>${addr}</p>
<h2>${esc(t.legal_contact)}</h2><p><a href="mailto:${esc(email)}">${esc(email)}</a></p>
${L.uid ? `<h2>${esc(t.legal_uid)}</h2><p>${esc(L.uid)}</p>` : ""}
<h2>${esc(t.legal_resp)}</h2><p>${esc(L.responsible ?? L.name)}</p>
<h2>${esc(t.legal_liab_h)}</h2><p>${esc(t.legal_liab)}</p>
<h2>${esc(t.legal_odr_h)}</h2><p>${esc(t.legal_odr)}</p>
<h2>${esc(t.legal_report_h)}</h2><p>${esc(t.legal_report)}</p><p><a class="btn" href="/report?lang=${l}">${esc(t.legal_report_btn)}</a></p>
<p class="back"><a class="btn" href="${prefix(l)}">${esc(t.back_home)}</a></p></article>`;
  return page(l, "legal/", `${t.legal_page_title} · Thirstr`, t.legal_page_title, body);
}

function notFound() {
  const body = `<div class="nf"><h1>404</h1>
${LANGS.map((l) => `<p lang="${l}"><strong>${esc(S[l].nf_title)}</strong> <a href="${prefix(l)}">${esc(S[l].back_home)}</a></p>`).join("\n")}</div>`;
  return page("en", "", "404 · Thirstr", S.en.description, body, { noindex: true });
}

// Empty (not remove) the output dir: in DEV it is a bind mount.
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f), { recursive: true, force: true });
const write = (p, s) => (mkdirSync(dirname(join(out, p)), { recursive: true }), writeFileSync(join(out, p), s));
for (const l of LANGS) {
  const base = l === "en" ? "" : `${l}/`;
  write(`${base}index.html`, home(l));
  write(`${base}privacy/index.html`, privacy(l));
  if (LEGAL) write(`${base}legal/index.html`, legal(l));
}
write("404.html", notFound());
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${CANON}/sitemap.xml\n`);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${LANGS.flatMap((l) =>
    ["", "privacy/", ...(LEGAL ? ["legal/"] : [])].map((s) => `<url><loc>${CANON}${prefix(l)}${s}</loc></url>`)
  ).join("\n")}\n</urlset>\n`
);
for (const f of ["site.css", "favicon.svg", "fonts", "c"]) cpSync(join(here, f), join(out, f), { recursive: true });
console.log(`site built → ${out}`);
