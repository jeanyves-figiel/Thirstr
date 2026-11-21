import { sha384 } from '@noble/hashes/sha2.js';
import { fromB64url, toB64url } from '../chat/bytes';

// F-03 R-03.4 client side of the Chaum RSA-FDH blind signature (server: Thirstr.Verification).
// The server signs H(token)·rᵉ without learning the token; we unblind with r⁻¹ and redeem.

const big = (b: Uint8Array) => b.reduce((n, x) => (n << 8n) | BigInt(x), 0n);

function bytes(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

export function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function inverse(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [m, a % m, 0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('not invertible');
  return ((s0 % m) + m) % m;
}

/** MGF1-SHA-384(token) to |n| bytes, reduced mod n. Must match Thirstr.Verification.fdh/2. */
export function fdh(token: Uint8Array, nBytes: Uint8Array): bigint {
  const len = nBytes.length;
  const out = new Uint8Array(Math.ceil(len / 48) * 48);
  for (let i = 0, off = 0; off < len; i++, off += 48) {
    const c = new Uint8Array(token.length + 4);
    c.set(token);
    new DataView(c.buffer).setUint32(token.length, i);
    out.set(sha384(c), off);
  }
  return big(out.subarray(0, len)) % big(nBytes);
}

export type IssuerKey = { n: string; e: number };

export function blind(token: Uint8Array, key: IssuerKey, rand: (n: number) => Uint8Array) {
  const nb = fromB64url(key.n);
  const n = big(nb);
  let r = 0n;
  while (r < 2n) r = big(rand(nb.length)) % n;
  const blinded = (fdh(token, nb) * modPow(r, BigInt(key.e), n)) % n;
  return { blinded: toB64url(bytes(blinded, nb.length)), unblind: (sig: string) => toB64url(bytes((big(fromB64url(sig)) * inverse(r, n)) % n, nb.length)) };
}
