// I-01 R-I01.5: link previews are built on the SENDER's phone, never on our server and never on
// the receiver's phone. No cookies, no shared cache, https only, size and time capped. The
// thumbnail is re-encoded (no EXIF) and sent end-to-end encrypted like chat media (F-08).
import { Platform as RN } from 'react-native';
import type { LinkPreview } from '../chat/engine';
import { readBytes, uploadEncrypted } from '../chat/media';
import { cleanUrl, displayHost, isAdult, platformOf, type Platform } from './links';

export type Preview = {
  url: string;
  host: string;
  platform: Platform;
  title?: string;
  text?: string;
  author?: string;
  img?: string;
  /** Platform labels (Bluesky) that make the receiver blur the picture. */
  labels?: string[];
  adult: boolean;
};

const UA = 'Mozilla/5.0 (compatible; Thirstr-Preview)';
const TIMEOUT = 5000;
const MAX_HTML = 1_000_000;
const MAX_IMG = 5 * 1024 * 1024;
const ADULT_LABELS = ['porn', 'sexual', 'nudity', 'graphic-media'];

async function get(url: string, accept: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    // credentials 'omit' + no-store: nothing from the person's browsing goes along (R-I01.5).
    return await fetch(url, { headers: { 'user-agent': UA, accept }, credentials: 'omit', cache: 'no-store', signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const clip = (s: string | undefined, n: number) => {
  if (!s) return undefined;
  const t = decode(s).replace(/\s+/g, ' ').trim();
  return t ? (t.length > n ? t.slice(0, n - 1) + '…' : t) : undefined;
};

/** OpenGraph → Twitter Card → <title>. Exported for tests. */
export function parseMeta(html: string) {
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    return tag?.match(/content=["']([^"']*)["']/i)?.[1];
  };
  return {
    title: meta('og:title') ?? meta('twitter:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1],
    text: meta('og:description') ?? meta('twitter:description') ?? meta('description'),
    img: meta('og:image') ?? meta('twitter:image'),
    url: meta('og:url'),
  };
}

async function generic(url: string, platform: Platform): Promise<Partial<Preview> & { final: string }> {
  const r = await get(url, 'text/html');
  const final = cleanUrl(r.url || url) ?? url;
  const len = Number(r.headers.get('content-length') ?? 0);
  if (!r.ok || len > MAX_HTML || !(r.headers.get('content-type') ?? '').includes('html')) return { final };
  const html = (await r.text()).slice(0, MAX_HTML);
  const m = parseMeta(html);
  // og:url only when it stays on the same site (R-I01.5), else the real redirect target.
  const og = m.url && cleanUrl(new URL(decode(m.url), final).toString());
  const same = og && displayHost(og).host.split('.').slice(-2).join('.') === displayHost(final).host.split('.').slice(-2).join('.');
  return {
    final: same ? og! : final,
    title: clip(m.title, 120),
    // R-I01.5: paywalled pages show only what is public; never logged in.
    text: isAdult(platform) ? undefined : clip(m.text, 200),
    img: m.img ? new URL(decode(m.img), final).toString() : undefined,
  };
}

async function bluesky(url: string): Promise<Partial<Preview> | null> {
  const m = new URL(url).pathname.match(/^\/profile\/([^/]+)\/post\/([a-z0-9]+)/i);
  if (!m) return null;
  const at = `at://${m[1]}/app.bsky.feed.post/${m[2]}`;
  const r = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&parentHeight=0&uri=${encodeURIComponent(at)}`, 'application/json');
  if (!r.ok) return null;
  const post = (await r.json())?.thread?.post;
  if (!post) return null;
  const e = post.embed ?? {};
  const imgs = e.images ?? e.media?.images;
  const img: string | undefined = imgs?.[0]?.thumb ?? e.external?.thumb ?? e.media?.external?.thumb;
  const labels = [...(post.labels ?? []), ...(post.author?.labels ?? [])].map((l: { val: string }) => l.val).filter((v: string) => ADULT_LABELS.includes(v));
  return {
    author: clip(post.author?.displayName || post.author?.handle, 60),
    title: post.author?.handle ? '@' + post.author.handle : undefined,
    text: clip(post.record?.text, 300),
    img,
    labels: labels.length ? labels : undefined,
  };
}

async function x(url: string): Promise<Partial<Preview> | null> {
  const r = await get(`https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`, 'application/json');
  if (!r.ok) return null;
  const j = await r.json();
  const p = String(j.html ?? '').match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  return { author: clip(j.author_name, 60), text: clip(p.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''), 280) };
}

// R-I01.6: 24 h, 200 entries, newest last.
const cache = new Map<string, { at: number; p: Preview }>();
const DAY = 86_400_000;

/** Builds a preview; never throws (failure → host-only card). */
export async function buildPreview(raw: string): Promise<Preview | null> {
  const url = cleanUrl(raw);
  if (!url) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < DAY) return hit.p;
  const platform = platformOf(url);
  let p: Preview = { url, host: displayHost(url).host, platform, adult: isAdult(platform) };
  try {
    const special = platform === 'bluesky' ? await bluesky(url) : platform === 'x' ? await x(url) : null;
    if (special) p = { ...p, ...special };
    else {
      const g = await generic(url, platform);
      const fp = platformOf(g.final);
      p = { ...p, ...g, url: g.final, host: displayHost(g.final).host, platform: fp, adult: isAdult(fp) };
      delete (p as { final?: string }).final;
    }
  } catch {
    /* host-only card */
  }
  cache.delete(url);
  cache.set(url, { at: Date.now(), p });
  while (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return p;
}

/** R-I01.5: picture → JPEG q 0.8, long side ≤ 480, EXIF gone, encrypted upload. */
async function thumb(img: string) {
  if (!img.startsWith('https://')) return null;
  const r = await get(img, 'image/*');
  if (!r.ok || Number(r.headers.get('content-length') ?? 0) > MAX_IMG) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_IMG) return null;
  let uri: string;
  if (RN.OS === 'web') uri = URL.createObjectURL(new Blob([buf]));
  else {
    const { File, Paths } = await import('expo-file-system');
    const f = new File(Paths.cache, `lp-${Date.now()}.img`);
    f.write(buf);
    uri = f.uri;
  }
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const ctx = ImageManipulator.manipulate(uri);
  const first = await ctx.renderAsync();
  const long = Math.max(first.width, first.height);
  const ctx2 = ImageManipulator.manipulate(uri);
  if (long > 480) ctx2.resize(first.width >= first.height ? { width: 480 } : { height: 480 });
  const out = await (await ctx2.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const bytes = await readBytes(out.uri);
  if (RN.OS !== 'web') {
    const { File } = await import('expo-file-system');
    for (const u of [uri, out.uri]) {
      try {
        new File(u).delete();
      } catch {
        /* already gone */
      }
    }
  }
  const ref = await uploadEncrypted(bytes);
  return { ...ref, mime: 'image/jpeg', w: out.width, h: out.height, size: bytes.length + 16 };
}

/** One upload per share: the same encrypted thumbnail goes to every chat of this share. */
export async function toPayload(p: Preview, text: string): Promise<LinkPreview> {
  const t = p.img ? await thumb(p.img).catch(() => null) : null;
  return {
    t: 'link.preview',
    url: p.url,
    host: p.host,
    platform: p.platform,
    title: p.title,
    text: p.text,
    author: p.author,
    labels: p.labels,
    thumb: t ?? undefined,
    msg: text.trim() ? text.trim().slice(0, 500) : undefined,
  };
}
