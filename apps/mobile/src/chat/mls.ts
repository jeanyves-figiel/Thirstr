// MLS client (F-07 R-07.1) on ts-mls, ciphersuite 1, pure-JS crypto (beta-build-plan.md).
// One MLS identity per (own profile, this device): credential identity = {"p": profile, "d": device}.
// Nothing here talks to the network except through the callbacks in engine.ts.
import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackage,
  getCiphersuiteFromName,
  joinGroup,
  nobleCryptoProvider,
  processPrivateMessage,
  type CiphersuiteImpl,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concat, fromB64, fromUtf8, hex, rand, toB64, utf8 } from './bytes';
import { kv } from './kv';

let implP: Promise<CiphersuiteImpl> | null = null;
export const suite = () =>
  (implP ??= nobleCryptoProvider.getCiphersuiteImpl(getCiphersuiteFromName('MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519')));

export type Member = { p: string; d: string };
type StoredKp = { profile: string; pub: string; priv: { i: string; h: string; s: string } };

const credential = (m: Member) => ({ credentialType: 'basic' as const, identity: utf8(JSON.stringify(m)) });
const encKp = (kp: KeyPackage) => encodeMlsMessage({ keyPackage: kp, wireformat: 'mls_key_package', version: 'mls10' } as never);
const decKp = (b: Uint8Array) => {
  const m = decodeMlsMessage(b, 0)?.[0] as { wireformat: string; keyPackage: KeyPackage } | undefined;
  if (!m || m.wireformat !== 'mls_key_package') throw new Error('not a key package');
  return m.keyPackage;
};
const packPriv = (p: PrivateKeyPackage) => ({ i: toB64(p.initPrivateKey), h: toB64(p.hpkePrivateKey), s: toB64(p.signaturePrivateKey) });
const unpackPriv = (p: StoredKp['priv']): PrivateKeyPackage => ({ initPrivateKey: fromB64(p.i), hpkePrivateKey: fromB64(p.h), signaturePrivateKey: fromB64(p.s) });

/** New key package for `profile` on this device; private part kept locally by sha256(public). */
export async function newKeyPackage(me: Member): Promise<{ wire: Uint8Array; ref: string }> {
  const impl = await suite();
  const kp = await generateKeyPackage(credential(me), defaultCapabilities(), defaultLifetime, [], impl);
  const wire = encKp(kp.publicPackage);
  const ref = hex(sha256(wire));
  await kv.set('kp:' + ref, { profile: me.p, pub: toB64(wire), priv: packPriv(kp.privatePackage) } satisfies StoredKp);
  return { wire, ref };
}

// ------------------------------------------------------------------ group state

async function save(groupId: string, s: ClientState) {
  await kv.set('grp:' + groupId, toB64(encodeGroupState(s)));
}

export async function load(groupId: string): Promise<ClientState | null> {
  const b = await kv.get<string>('grp:' + groupId);
  if (!b) return null;
  const decoded = decodeGroupState(fromB64(b), 0)?.[0];
  // decodeGroupState drops the client config; re-attach it (see thirstr-beta-build notes).
  return decoded ? ({ ...decoded, clientConfig: defaultClientConfig } as ClientState) : null;
}

/** Members (profile + device) from the ratchet tree, with their leaf index. */
export function leaves(s: ClientState): (Member & { leaf: number })[] {
  const out: (Member & { leaf: number })[] = [];
  s.ratchetTree.forEach((n, i) => {
    if (n?.nodeType !== 'leaf') return;
    try {
      const c = n.leaf.credential as { identity?: Uint8Array };
      if (c.identity) out.push({ ...(JSON.parse(fromUtf8(c.identity)) as Member), leaf: i / 2 });
    } catch {
      // foreign credential: ignore
    }
  });
  return out;
}

export const members = (s: ClientState): Member[] => leaves(s).map(({ p, d }) => ({ p, d }));

// Group welcomes carry a small header so the receiver knows which party/activity/club chat it is:
// sha256(key package) ‖ '{"ctx":"party:…"}\n' ‖ MLS Welcome. 1:1 welcomes have no header.
const header = (ctx?: string) => (ctx ? utf8(JSON.stringify({ ctx }) + '\n') : new Uint8Array(0));

function splitWelcome(rest: Uint8Array): { ctx?: string; body: Uint8Array } {
  if (rest[0] !== 0x7b) return { body: rest };
  const nl = rest.indexOf(0x0a);
  try {
    const h = JSON.parse(fromUtf8(rest.slice(0, nl))) as { ctx?: string };
    return { ctx: h.ctx, body: rest.slice(nl + 1) };
  } catch {
    return { body: rest };
  }
}

type Claimed = { id: number; device_id: string; key_package: string; profile: string };

/** Adds claimed key packages to an existing group (host side). Returns commit + welcomes. */
export async function addMembers(groupId: string, claimed: Claimed[], ctx?: string) {
  const impl = await suite();
  const state = await load(groupId);
  if (!state) throw new Error('unknown group');
  const before = members(state);
  const kps = claimed.map((c) => ({ c, wire: fromB64(c.key_package) }));
  const r = await createCommit(
    { state, cipherSuite: impl },
    { ratchetTreeExtension: true, extraProposals: kps.map((k) => ({ proposalType: 'add' as const, add: { keyPackage: decKp(k.wire) } })) },
  );
  await save(groupId, r.newState);
  const welcome = encodeMlsMessage({ welcome: r.welcome!, wireformat: 'mls_welcome', version: 'mls10' } as never);
  const welcomes: Envelope[] = kps.map((k) => ({
    to_profile_id: k.c.profile,
    to_device_id: k.c.device_id,
    kind: 'welcome',
    key_package_id: k.c.id,
    ciphertext: toB64(concat(sha256(k.wire), header(ctx), welcome)),
  }));
  return { commit: encodeMlsMessage(r.commit as never), before, welcomes };
}

/** Removes every leaf of the given profiles (host side). Returns the commit and who must get it. */
export async function removeProfiles(groupId: string, profiles: string[]) {
  const impl = await suite();
  const state = await load(groupId);
  if (!state) throw new Error('unknown group');
  const gone = leaves(state).filter((l) => profiles.includes(l.p));
  if (!gone.length) return null;
  const r = await createCommit(
    { state, cipherSuite: impl },
    { ratchetTreeExtension: true, extraProposals: gone.map((l) => ({ proposalType: 'remove' as const, remove: { removed: l.leaf } })) },
  );
  await save(groupId, r.newState);
  return { commit: encodeMlsMessage(r.commit as never), to: members(r.newState) };
}

export type Envelope = { to_profile_id: string; to_device_id: string; kind: 'welcome' | 'commit' | 'app'; key_package_id?: number; ciphertext: string };

/**
 * Creates a 1:1 (or small) group from claimed key packages. Returns the group id and welcome
 * envelopes. Welcome wire = sha256(recipient key package) ‖ MLS Welcome, so the receiver finds
 * its private key package without trial decryption.
 */
export async function createWith(me: Member, claimed: Claimed[], ctx?: string) {
  const impl = await suite();
  const own = await generateKeyPackage(credential(me), defaultCapabilities(), defaultLifetime, [], impl);
  const gid = rand(16);
  let state = await createGroup(gid, own.publicPackage, own.privatePackage, [], impl);
  const kps = claimed.map((c) => ({ c, wire: fromB64(c.key_package) }));
  const commit = await createCommit(
    { state, cipherSuite: impl },
    { ratchetTreeExtension: true, extraProposals: kps.map((k) => ({ proposalType: 'add' as const, add: { keyPackage: decKp(k.wire) } })) },
  );
  state = commit.newState;
  const groupId = hex(gid);
  await save(groupId, state);
  const welcome = encodeMlsMessage({ welcome: commit.welcome!, wireformat: 'mls_welcome', version: 'mls10' } as never);
  const envelopes: Envelope[] = kps.map((k) => ({
    to_profile_id: k.c.profile,
    to_device_id: k.c.device_id,
    kind: 'welcome',
    key_package_id: k.c.id,
    ciphertext: toB64(concat(sha256(k.wire), header(ctx), welcome)),
  }));
  return { groupId, gid, envelopes };
}

/** Joins from a welcome envelope. Returns group id and members, or null if no matching key. */
export async function join(wire: Uint8Array): Promise<{ groupId: string; members: Member[]; me: string; ctx?: string } | null> {
  const impl = await suite();
  const ref = hex(wire.slice(0, 32));
  const stored = await kv.get<StoredKp>('kp:' + ref);
  if (!stored) return null;
  const { ctx, body } = splitWelcome(wire.slice(32));
  const msg = decodeMlsMessage(body, 0)?.[0] as { wireformat: string; welcome: never } | undefined;
  if (!msg || msg.wireformat !== 'mls_welcome') return null;
  const state = await joinGroup(msg.welcome, decKp(fromB64(stored.pub)), unpackPriv(stored.priv), emptyPskIndex, impl);
  const groupId = hex(state.groupContext.groupId as Uint8Array);
  await save(groupId, state);
  // single-use: forget it, unless it was the last-resort package (still on the server)
  const lr = await kv.get<string>('kp:lastresort:' + stored.profile);
  if (lr !== ref) await kv.del('kp:' + ref);
  return { groupId, members: members(state), me: stored.profile, ctx };
}

/** Encrypts an application message for the group. */
export async function seal(groupId: string, plaintext: Uint8Array): Promise<{ wire: Uint8Array; members: Member[] }> {
  const impl = await suite();
  const state = await load(groupId);
  if (!state) throw new Error('unknown group');
  const r = await createApplicationMessage(state, plaintext, impl);
  await save(groupId, r.newState);
  const wire = encodeMlsMessage({ privateMessage: r.privateMessage, wireformat: 'mls_private_message', version: 'mls10' } as never);
  return { wire, members: members(r.newState) };
}

/** Decrypts an application message, or applies a commit (returns null then). Throws if it can't (yet). */
export async function open(groupId: string, wire: Uint8Array): Promise<Uint8Array | null> {
  const impl = await suite();
  const state = await load(groupId);
  // Unknown group: may arrive before its welcome (R-07.20), so the caller keeps it.
  if (!state) throw new Error('no_group');
  const msg = decodeMlsMessage(wire, 0)?.[0] as { wireformat: string; privateMessage: never } | undefined;
  if (!msg || msg.wireformat !== 'mls_private_message') throw new Error('malformed');
  const r = await processPrivateMessage(state, msg.privateMessage, emptyPskIndex, impl);
  await save(groupId, r.newState);
  return r.kind === 'applicationMessage' ? (r.message as Uint8Array) : null;
}

export async function forget(groupId: string) {
  await kv.del('grp:' + groupId);
}
