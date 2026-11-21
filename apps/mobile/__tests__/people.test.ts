// #115 favorites, private notes and friends (F-07 R-07.32–R-07.38): device-only state.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { kv } from '../src/chat/kv';
import * as P from '../src/chat/people';

jest.mock('../src/chat/kv', () => {
  const st = new Map<string, unknown>();
  const clone = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const keys = (p: string) => [...st.keys()].filter((k) => k.startsWith(p));
  return {
    kv: {
      get: async (k: string) => (st.has(k) ? clone(st.get(k)) : null),
      set: async (k: string, v: unknown) => void st.set(k, clone(v)),
      del: async (k: string) => void st.delete(k),
      keys: async (p: string) => keys(p),
      wipe: async () => st.clear(),
    },
  };
});

beforeEach(async () => {
  await kv.wipe();
  P.resetPeople();
  await P.loadPeople();
});

describe('R-07.32 favorites', () => {
  it('stars a person privately, newest first, survives a relaunch', async () => {
    await P.setFav('pb', true, { name: 'Marco', photo: null });
    await P.setFav('pc', true, { name: 'Theo' });
    expect(P.favList().map((f) => f.peer)).toEqual(expect.arrayContaining(['pb', 'pc']));
    expect(P.isFav('pb')).toBe(true);
    P.resetPeople();
    await P.loadPeople();
    expect(P.isFav('pc')).toBe(true);
    await P.setFav('pb', false);
    expect(P.isFav('pb')).toBe(false);
  });
});

describe('R-07.34 / R-07.35 notes and search', () => {
  it('cleans tags, caps lengths, deletes an empty note', async () => {
    const n = await P.setNote('pb', { text: '  Met at Bear night  ', tags: ['#gym', 'gym', ' vers ', '', ...Array.from({ length: 12 }, (_, i) => 't' + i)] });
    expect(n.text).toBe('Met at Bear night');
    expect(n.tags.slice(0, 2)).toEqual(['gym', 'vers']);
    expect(n.tags).toHaveLength(P.TAGS_MAX);
    expect((await P.setNote('pc', { text: 'x'.repeat(600), tags: [] })).text).toHaveLength(P.NOTE_MAX);
    await P.setNote('pc', { text: ' ', tags: [] });
    expect(P.noteFor('pc')).toBeNull();
    expect(await kv.get('note:pc')).toBeNull();
  });

  it('AC-07.16: search finds a chat by note text or tag, not by others', async () => {
    await P.setNote('pb', { text: 'Met at Bear night', tags: ['gym'] });
    expect(P.matches('gym', 'pb', 'Marco', 'Still up?')).toBe(true);
    expect(P.matches('bear', 'pb', 'Marco')).toBe(true);
    expect(P.matches('gym', 'pc', 'Theo', 'Haha')).toBe(false);
    expect(P.matches('', 'pc', 'Theo')).toBe(true);
    expect(P.noteLine('pb')).toBe('gym');
    expect(P.myTags()).toEqual([{ tag: 'gym', n: 1 }]);
  });

  it('loads notes written by the old profile card (note:<id> keys)', async () => {
    await kv.set('note:pz', { text: 'old', tags: [] });
    P.resetPeople();
    await P.loadPeople();
    expect(P.noteFor('pz')?.text).toBe('old');
  });
});

describe('R-07.36 friend state machine', () => {
  it('request → accept, both sides', async () => {
    expect(await P.applyFriend('pb', 'request', true)).toBe(true);
    expect(P.friendOf('pb')).toBe('out');
    expect(await P.applyFriend('pb', 'accept', false)).toBe(true);
    expect(P.friendOf('pb')).toBe('yes');
    expect(await P.applyFriend('pc', 'request', false)).toBe(true);
    expect(P.friendOf('pc')).toBe('in');
    expect(await P.applyFriend('pc', 'accept', true)).toBe(true);
    expect(P.friendList('yes').sort()).toEqual(['pb', 'pc']);
  });

  it('both ask at once → friends', async () => {
    await P.applyFriend('pb', 'request', true);
    await P.applyFriend('pb', 'request', false);
    expect(P.friendOf('pb')).toBe('yes');
  });

  it('accept without a pending request is ignored', async () => {
    expect(await P.applyFriend('pb', 'accept', false)).toBe(false);
    expect(P.friendOf('pb')).toBeNull();
  });

  it('decline is quiet and pauses asking again for 7 days', async () => {
    await P.applyFriend('pb', 'request', true);
    expect(await P.applyFriend('pb', 'decline', false)).toBe(false);
    expect(P.friendOf('pb')).toBeNull();
    expect(P.canAsk('pb')).toBe(false);
    expect(P.canAsk('pb', Date.now() + P.ASK_AGAIN_MS + 1)).toBe(true);
  });

  it('cancel and remove are quiet; block forgets without sending', async () => {
    await P.applyFriend('pb', 'request', false);
    expect(await P.applyFriend('pb', 'cancel', false)).toBe(false);
    expect(P.friendOf('pb')).toBeNull();
    await P.applyFriend('pc', 'request', true);
    await P.applyFriend('pc', 'accept', false);
    expect(await P.applyFriend('pc', 'remove', false)).toBe(false);
    expect(P.friendOf('pc')).toBeNull();
    await P.applyFriend('pd', 'request', false);
    await P.forgetFriend('pd');
    expect(P.friendOf('pd')).toBeNull();
  });

  it('export holds favorites, friends and notes (R-07.38)', async () => {
    await P.setFav('pb', true);
    await P.applyFriend('pb', 'request', true);
    await P.setNote('pb', { text: 'n', tags: [] });
    const x = P.exportPeople();
    expect(Object.keys(x.notes)).toEqual(['pb']);
    expect(x.friends).toEqual({ pb: 'out' });
    expect(x.favorites[0].peer).toBe('pb');
  });
});
