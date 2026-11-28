import { describe, expect, it, jest } from '@jest/globals';
import { newKey, retriable } from '../src/api/idempotency';

jest.mock('expo-crypto', () => ({ randomUUID: () => '0b8e7c1a-3f2d-4e5b-9c6d-7a8b9c0d1e2f' }));

// DB-10 (#335): which calls carry a de-duplicated Idempotency-Key and may be retried.
describe('idempotency', () => {
  it('creates are retriable, other calls are not', () => {
    expect(retriable('POST', '/parties')).toBe(true);
    expect(retriable('post', '/parties/abc/request')).toBe(true);
    expect(retriable('POST', '/me/profiles/p1/photos')).toBe(true);
    expect(retriable('POST', '/trips?x=1')).toBe(true);
    expect(retriable('GET', '/parties')).toBe(false);
    expect(retriable('POST', '/mls/messages')).toBe(false);
    expect(retriable('POST', '/auth/refresh')).toBe(false);
    expect(retriable('POST', '/parties/abc/leave')).toBe(false);
  });
  it('key matches the server rule', () => {
    expect(newKey()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
