import * as ExpoCrypto from 'expo-crypto';

/**
 * DB-10 (#335, docs/spec/db-integrity.md, api.md › Idempotency). Every POST carries a fresh
 * `Idempotency-Key`; the server stores the answer for these creates, so a repeat of the same call
 * (lost answer, timeout) returns the first result instead of storing a second party, plan, trip …
 * Mirrors ThirstrWeb.Plugs.Idempotency @routes: keep both lists in step.
 */
const ROUTES: RegExp[] = [
  /^\/tonight$/,
  /^\/trips$/,
  /^\/parties$/,
  /^\/parties\/[^/]+\/(request|report)$/,
  /^\/activities$/,
  /^\/activities\/[^/]+\/rsvp$/,
  /^\/clubs$/,
  /^\/clubs\/[^/]+\/join$/,
  /^\/reports$/,
  /^\/support\/requests$/,
  /^\/support\/requests\/[^/]+\/messages$/,
  /^\/feedback$/,
  /^\/moments\/[^/]+\/publish$/,
  /^\/profiles\/[^/]+\/vouch$/,
  /^\/me\/profiles\/[^/]+\/photos$/,
];

/** True when the server de-duplicates this call, so a lost answer may be retried with the same key. */
export function retriable(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const p = path.split('?')[0];
  return ROUTES.some((r) => r.test(p));
}

/** 8–64 chars of [A-Za-z0-9_-] (server rule). */
export function newKey(): string {
  return ExpoCrypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, '');
}
