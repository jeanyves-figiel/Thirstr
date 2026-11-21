import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, plan, HELP, LANGS } from '../src/replies.ts';

test('plain text: German reply by default, counter moves', () => {
  const r = plan('hi', initialState(), () => 0);
  assert.equal(r.out.length, 1);
  assert.equal(r.out[0].p!.t, 'text');
  assert.match((r.out[0].p as { text: string }).text, /Hey!/);
  assert.equal(r.state.n, 1);
});

test('lang switches the reply language; unknown lang lists options', () => {
  const r = plan('lang pt', initialState());
  assert.equal(r.state.lang, 'pt');
  assert.match((plan('ok', r.state, () => 0).out[0].p as { text: string }).text, /você|Oi|legal|tempo|bot/);
  assert.match((plan('lang xx', initialState()).out[0].p as { text: string }).text, /de \| pt/);
});

test('mix rotates through all languages', () => {
  let s = plan('mix', initialState()).state;
  const seen = new Set<string>();
  for (let i = 0; i < LANGS.length; i++) {
    const r = plan('x', s, () => 0);
    seen.add((r.out[0].p as { text: string }).text);
    s = r.state;
  }
  assert.equal(seen.size, LANGS.length);
});

test('burst is capped at 10, later at 600 s, receipts toggles', () => {
  assert.equal(plan('burst 50', initialState()).out.length, 10);
  const later = plan('later 9999', initialState()).out;
  assert.equal(later[1].delayMs, 600_000);
  const off = plan('receipts off', initialState()).state;
  assert.deepEqual([off.delivered, off.read], [false, false]);
  assert.equal(plan('noread', initialState()).state.read, false);
});

test('help and echo', () => {
  assert.equal((plan('help', initialState()).out[0].p as { text: string }).text, HELP);
  assert.equal((plan('echo Grüezi mitenand', initialState()).out[0].p as { text: string }).text, 'Grüezi mitenand');
});
