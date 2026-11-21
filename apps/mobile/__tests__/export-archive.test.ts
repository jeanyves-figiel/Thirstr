import { describe, expect, it, jest } from '@jest/globals';
import { gcm } from '@noble/ciphers/aes.js';
import { strFromU8, unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

// #25 R-01.11: the export is one zip with data.json, profile photos and decrypted private album items.
const key = new Uint8Array(32).fill(7);
const iv = new Uint8Array(12).fill(3);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const albumPlain = new Uint8Array([1, 2, 3, 4, 5]);
const albumCipher = gcm(key, iv).encrypt(albumPlain);

const mockStore = new Map<string, unknown>([
  ['albums', [{ id: 'abcd1234', name: 'Beach/2026', items: [{ blob: 'b1', key: b64(key), iv: b64(iv), mime: 'image/jpeg' }], shares: [{ cid: 'c1' }] }]],
  ['note:p9', 'met at gym'],
  ['favs', { p9: true }],
]);
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: unknown) => void mockStore.set(k, v),
    keys: async (pre: string) => [...mockStore.keys()].filter((k) => k.startsWith(pre)),
  },
}));
jest.mock('../src/api/client', () => ({
  api: async (_m: string, path: string) => {
    if (path === '/account/export')
      return { format: 'thirstr-export/1', account: { id: 'a1' }, data: { photos: [{ id: 'ph1', profile_id: 'prof0001-x', slot: 0, status: 'ok', url: 'https://s3/ph1' }, { id: 'ph2', profile_id: 'prof0001-x', slot: 1, status: 'ok', url: 'https://s3/missing' }] } };
    if (path === '/media/b1') return { url: 'https://s3/b1' };
    throw new Error('unexpected ' + path);
  },
}));
jest.mock('../src/chat/engine', () => ({
  getConvs: () => [{ id: 'c1', name: 'Leo', peer: 'p9' }],
  messages: async () => [{ from: 'me', at: 0, p: { t: 'text', text: 'hi' } }],
}));
jest.mock('../src/chat/albums', () => ({ listAlbums: async () => mockStore.get('albums') }));

(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  if (url === 'https://s3/ph1') return { ok: true, arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
  if (url === 'https://s3/b1') return { ok: true, arrayBuffer: async () => albumCipher.slice().buffer };
  return { ok: false, status: 404 };
};

import { collect, ExportCancelled, ExportProgress } from '../src/me/exportData';

async function build(cancelled = () => false) {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((_e, c) => chunks.push(c));
  const stages: ExportProgress[] = [];
  await collect(
    (path, data, compress) => {
      const f = compress ? new ZipDeflate(path) : new ZipPassThrough(path);
      zip.add(f);
      f.push(data, true);
    },
    (p) => stages.push(p),
    cancelled,
  );
  zip.end();
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return { files: unzipSync(all), stages };
}

describe('#25 data export archive (R-01.11)', () => {
  it('packs data.json, profile photos and decrypted album items', async () => {
    const { files, stages } = await build();
    expect(Object.keys(files).sort()).toEqual(['albums/Beach_2026-abcd/001.jpg', 'data.json', 'photos/prof0001-1.jpg']);
    expect([...files['albums/Beach_2026-abcd/001.jpg']]).toEqual([...albumPlain]);
    const json = JSON.parse(strFromU8(files['data.json']));
    expect(json.data.photos).toEqual([
      { id: 'ph1', profile_id: 'prof0001-x', slot: 0, status: 'ok', file: 'photos/prof0001-1.jpg' },
      { id: 'ph2', profile_id: 'prof0001-x', slot: 1, status: 'ok', file: null },
    ]);
    expect(JSON.stringify(json)).not.toContain('https://s3');
    expect(json.device.private_albums).toEqual([{ name: 'Beach/2026', items: ['albums/Beach_2026-abcd/001.jpg'], shared_in_chats: 1 }]);
    expect(json.device.private_notes).toEqual([{ profile: 'p9', note: 'met at gym' }]);
    expect(json.device.chats[0].messages[0]).toMatchObject({ from: 'me', type: 'text', text: 'hi' });
    expect(stages.map((s) => s.stage)).toContain('albums');
  });

  it('stops when cancelled', async () => {
    let n = 0;
    await expect(build(() => ++n > 2)).rejects.toBeInstanceOf(ExportCancelled);
  });
});
