/* global test, expect, Buffer */
// #168 certificate pinning config plugin: pins are CA SPKI hashes, hosts are only ours.
const plugin = require('../plugins/with-cert-pinning');

test('six CA pins, each a base64 SHA-256', () => {
  expect(plugin.PINS).toHaveLength(6);
  for (const p of plugin.PINS) expect(Buffer.from(p.spki, 'base64')).toHaveLength(32);
  expect(new Set(plugin.PINS.map((p) => p.spki)).size).toBe(6);
});

test('hosts: prod + staging always, the build API host only when it is ours over https', () => {
  const old = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'https://localhost:7443';
  expect(plugin.hosts()).toEqual(['api.thirstr.fun', 'staging.thirstr.fun']);
  process.env.EXPO_PUBLIC_API_URL = 'https://evil.example';
  expect(plugin.hosts()).toEqual(['api.thirstr.fun', 'staging.thirstr.fun']);
  process.env.EXPO_PUBLIC_API_URL = 'https://beta.thirstr.fun';
  expect(plugin.hosts()).toContain('beta.thirstr.fun');
  process.env.EXPO_PUBLIC_API_URL = old;
});

test('Android config: pinned domains with expiration, no cleartext except local dev hosts', () => {
  const xml = plugin.androidXml(['api.thirstr.fun']);
  expect(xml).toContain('<domain includeSubdomains="false">api.thirstr.fun</domain>');
  expect(xml).toMatch(/<pin-set expiration="\d{4}-\d{2}-\d{2}">/);
  for (const p of plugin.PINS) expect(xml).toContain(p.spki);
  expect(xml.match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1);
  expect(xml).not.toMatch(/<base-config/);
});
