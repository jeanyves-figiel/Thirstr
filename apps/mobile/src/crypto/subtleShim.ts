// Minimal WebCrypto `crypto.subtle` for Hermes (no native WebCrypto), backed by audited
// noble libraries. Covers exactly the operations ts-mls / @hpke use for ciphersuite 1
// (X25519, Ed25519, HMAC/HKDF-SHA256, AES-128-GCM) plus SHA digests. Installed only when the
// runtime has no crypto.subtle (beta-build-plan.md › MLS client).
import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

type Alg = string | { name: string; [k: string]: unknown };
type Bytes = Uint8Array;
type ShimKey = {
  type: 'public' | 'private' | 'secret';
  extractable: boolean;
  algorithm: { name: string; hash?: { name: string } };
  usages: string[];
  _raw: Bytes;
  _pub?: Bytes;
};

const nameOf = (a: Alg) => (typeof a === 'string' ? a : a.name).toUpperCase();
const hashOf = (h: unknown) => {
  const n = (typeof h === 'string' ? h : (h as { name: string })?.name ?? 'SHA-256').toUpperCase();
  if (n === 'SHA-256') return sha256;
  if (n === 'SHA-384') return sha384;
  if (n === 'SHA-512') return sha512;
  throw new Error('NotSupported hash ' + n);
};
const u8 = (d: ArrayBuffer | ArrayBufferView): Bytes =>
  d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
const out = (b: Bytes): ArrayBuffer => b.slice().buffer as ArrayBuffer;

// RFC 8410 PKCS#8 wrappers for 32-byte OKP private keys.
const PKCS8 = {
  ED25519: Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]),
  X25519: Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]),
} as const;
const b64u = {
  enc: (b: Bytes) => {
    let s = '';
    b.forEach((x) => (s += String.fromCharCode(x)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};

const okp = (name: 'ED25519' | 'X25519') => (name === 'ED25519' ? ed25519 : x25519);
const pubOf = (name: 'ED25519' | 'X25519', priv: Bytes) => okp(name).getPublicKey(priv);
const algName = (n: string) => (n === 'ED25519' ? 'Ed25519' : n === 'X25519' ? 'X25519' : n === 'AES-GCM' ? 'AES-GCM' : n);

function key(type: ShimKey['type'], name: string, raw: Bytes, extractable: boolean, usages: string[], extra: Partial<ShimKey> = {}): ShimKey {
  return { type, extractable, algorithm: { name: algName(name) }, usages, _raw: raw, ...extra };
}

export const subtleShim = {
  async digest(alg: Alg, data: ArrayBufferView | ArrayBuffer) {
    return out(hashOf(nameOf(alg))(u8(data)));
  },

  async generateKey(alg: Alg, extractable: boolean, usages: string[]) {
    const n = nameOf(alg);
    if (n === 'ED25519' || n === 'X25519') {
      const priv = okp(n).utils.randomSecretKey();
      const pub = pubOf(n, priv);
      return {
        privateKey: key('private', n, priv, extractable, usages.filter((u) => u !== 'verify'), { _pub: pub }),
        publicKey: key('public', n, pub, true, n === 'ED25519' ? ['verify'] : []),
      };
    }
    if (n === 'AES-GCM' || n === 'HMAC') {
      const len = n === 'HMAC' ? 32 : (((alg as { length?: number }).length ?? 128) / 8);
      const raw = new Uint8Array(len);
      crypto.getRandomValues(raw);
      return key('secret', n, raw, extractable, usages, n === 'HMAC' ? { algorithm: { name: 'HMAC', hash: { name: 'SHA-256' } } } : {});
    }
    throw new Error('NotSupported generateKey ' + n);
  },

  async importKey(format: string, data: unknown, alg: Alg, extractable: boolean, usages: string[]) {
    const n = nameOf(alg);
    if (n === 'HMAC') {
      const h = (alg as { hash?: unknown }).hash;
      return key('secret', 'HMAC', u8(data as Bytes).slice(), extractable, usages, { algorithm: { name: 'HMAC', hash: { name: typeof h === 'string' ? h : ((h as { name: string })?.name ?? 'SHA-256') } } });
    }
    if (n === 'HKDF' || n === 'AES-GCM') return key('secret', n, u8(data as Bytes).slice(), extractable, usages);
    if (n === 'ED25519' || n === 'X25519') {
      if (format === 'raw') return key('public', n, u8(data as Bytes).slice(), true, usages);
      if (format === 'pkcs8') {
        const b = u8(data as Bytes);
        const priv = b.slice(b.length - 32);
        return key('private', n, priv, extractable, usages, { _pub: pubOf(n, priv) });
      }
      if (format === 'jwk') {
        const j = data as { d?: string; x: string };
        if (j.d) {
          const priv = b64u.dec(j.d);
          return key('private', n, priv, extractable, usages, { _pub: pubOf(n, priv) });
        }
        return key('public', n, b64u.dec(j.x), true, usages);
      }
    }
    throw new Error(`NotSupported importKey ${format} ${n}`);
  },

  async exportKey(format: string, k: ShimKey) {
    const n = k.algorithm.name.toUpperCase() as 'ED25519' | 'X25519';
    if (format === 'raw') return out(k._raw);
    if (format === 'pkcs8' && k.type === 'private') {
      const p = PKCS8[n];
      const b = new Uint8Array(p.length + 32);
      b.set(p);
      b.set(k._raw, p.length);
      return out(b);
    }
    if (format === 'jwk') {
      const crv = n === 'ED25519' ? 'Ed25519' : 'X25519';
      return k.type === 'private'
        ? { kty: 'OKP', crv, d: b64u.enc(k._raw), x: b64u.enc(k._pub ?? pubOf(n, k._raw)), ext: true, key_ops: k.usages }
        : { kty: 'OKP', crv, x: b64u.enc(k._raw), ext: true, key_ops: k.usages };
    }
    throw new Error(`NotSupported exportKey ${format} ${n}`);
  },

  async sign(alg: Alg, k: ShimKey, data: ArrayBufferView | ArrayBuffer) {
    const n = nameOf(alg);
    if (n === 'ED25519') return out(ed25519.sign(u8(data), k._raw));
    if (n === 'HMAC') return out(hmac(hashOf(k.algorithm.hash), k._raw, u8(data)));
    throw new Error('NotSupported sign ' + n);
  },

  async verify(alg: Alg, k: ShimKey, sig: ArrayBufferView | ArrayBuffer, data: ArrayBufferView | ArrayBuffer) {
    const n = nameOf(alg);
    if (n === 'ED25519') {
      try {
        return ed25519.verify(u8(sig), u8(data), k._raw);
      } catch {
        return false;
      }
    }
    if (n === 'HMAC') {
      const mac = hmac(hashOf(k.algorithm.hash), k._raw, u8(data));
      const s = u8(sig);
      if (s.length !== mac.length) return false;
      let d = 0;
      for (let i = 0; i < mac.length; i++) d |= mac[i] ^ s[i];
      return d === 0;
    }
    throw new Error('NotSupported verify ' + n);
  },

  async deriveBits(alg: Alg & { public?: ShimKey; hash?: unknown; salt?: BufferSource; info?: BufferSource }, k: ShimKey, length: number) {
    const n = nameOf(alg);
    if (n === 'X25519') {
      const shared = x25519.getSharedSecret(k._raw, (alg as { public: ShimKey }).public._raw);
      return out(length ? shared.slice(0, length / 8) : shared);
    }
    if (n === 'HKDF') {
      const a = alg as { hash: unknown; salt?: BufferSource; info?: BufferSource };
      return out(hkdf(hashOf(a.hash), k._raw, a.salt ? u8(a.salt as Bytes) : undefined, a.info ? u8(a.info as Bytes) : undefined, length / 8));
    }
    throw new Error('NotSupported deriveBits ' + n);
  },

  async encrypt(alg: { name: string; iv: BufferSource; additionalData?: BufferSource }, k: ShimKey, data: ArrayBufferView | ArrayBuffer) {
    if (nameOf(alg) !== 'AES-GCM') throw new Error('NotSupported encrypt');
    return out(gcm(k._raw, u8(alg.iv as Bytes), alg.additionalData ? u8(alg.additionalData as Bytes) : undefined).encrypt(u8(data)));
  },

  async decrypt(alg: { name: string; iv: BufferSource; additionalData?: BufferSource }, k: ShimKey, data: ArrayBufferView | ArrayBuffer) {
    if (nameOf(alg) !== 'AES-GCM') throw new Error('NotSupported decrypt');
    try {
      return out(gcm(k._raw, u8(alg.iv as Bytes), alg.additionalData ? u8(alg.additionalData as Bytes) : undefined).decrypt(u8(data)));
    } catch {
      throw new Error('OperationError');
    }
  },
};

/** Installs the shim when the runtime lacks WebCrypto (Hermes). Needs crypto.getRandomValues. */
export function installSubtle() {
  const g = globalThis as unknown as { crypto?: { subtle?: unknown; getRandomValues?: unknown } };
  if (!g.crypto) throw new Error('crypto.getRandomValues polyfill missing');
  if (!g.crypto.subtle) Object.defineProperty(g.crypto, 'subtle', { value: subtleShim, configurable: true });
}
