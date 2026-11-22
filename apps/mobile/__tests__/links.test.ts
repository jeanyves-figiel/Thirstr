// I-01 (#17): link rules that run on the phone.
import { describe, expect, jest, test } from '@jest/globals';
import { cleanUrl, displayHost, firstUrl, platformOf } from '../src/links/links';
import { parseMeta } from '../src/links/preview';
import { lxAll } from '../src/i18n/links';

jest.mock('../src/chat/media', () => ({ readBytes: jest.fn(), uploadEncrypted: jest.fn() }));

describe('links', () => {
  test('first https link, trackers removed, http upgraded', () => {
    expect(firstUrl('look https://x.com/max/status/1?s=20&t=abc, nice')).toBe('https://x.com/max/status/1');
    expect(firstUrl('http://bsky.app/profile/a.bsky.social/post/3k?utm_source=x')).toBe('https://bsky.app/profile/a.bsky.social/post/3k');
    expect(firstUrl('no link here')).toBeNull();
  });

  test('refuses local, IP and credential URLs (R-I01.5)', () => {
    expect(cleanUrl('https://localhost/x')).toBeNull();
    expect(cleanUrl('https://192.168.1.2/x')).toBeNull();
    expect(cleanUrl('https://printer.local/')).toBeNull();
    expect(cleanUrl('https://user:pw@example.com/')).toBeNull();
    expect(cleanUrl('ftp://example.com/')).toBeNull();
  });

  test('platforms and hosts', () => {
    expect(platformOf('https://www.onlyfans.com/max')).toBe('onlyfans');
    expect(platformOf('https://twitter.com/a')).toBe('x');
    expect(platformOf('https://justfor.fans/max')).toBe('jff');
    expect(platformOf('https://example.org')).toBe('web');
    expect(displayHost('https://xn--pple-43d.com/').mixed).toBe(true);
    expect(displayHost('https://bsky.app/x').mixed).toBe(false);
  });

  test('OpenGraph parsing', () => {
    const m = parseMeta('<html><head><meta property="og:title" content="Run &amp; coffee"><meta name="og:image" content="/a.jpg"><title>T</title></head></html>');
    expect(m.title).toBe('Run &amp; coffee');
    expect(m.img).toBe('/a.jpg');
    expect(parseMeta('<title>Only title</title>').title).toBe('Only title');
  });

  test('every string exists in en, fr and de', () => {
    const keys = Object.keys(lxAll.en).sort();
    expect(Object.keys(lxAll.fr).sort()).toEqual(keys);
    expect(Object.keys(lxAll.de).sort()).toEqual(keys);
  });
});
