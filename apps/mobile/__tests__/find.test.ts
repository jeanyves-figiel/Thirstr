// #121 search inside a chat (F-07 R-07.39): on the phone only.
/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, jest } from '@jest/globals';
import type { Msg } from '../src/chat/engine';
import { findHits, findMatches, findText } from '../src/chat/find';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const msg = (id: string, p: Msg['p']): { m: Msg } => ({ m: { id, from: 'them', at: 0, p } });

describe('R-07.39 search in chat', () => {
  it('matches case- and accent-insensitively, from 2 letters', () => {
    expect(findMatches('Café on Langstrasse', 'cafe')).toBe(true);
    expect(findMatches('Café on Langstrasse', 'LANGSTR')).toBe(true);
    expect(findMatches('anything', 'a')).toBe(false);
    expect(findMatches('anything', '  ')).toBe(false);
  });

  it('searches text, quick replies and album names; newest first', () => {
    const list = [
      msg('3', { t: 'text', text: 'Langstrasse 120, red door' }),
      msg('2', { t: 'reaction', to: '1', emoji: '🔥' }),
      msg('1', { t: 'text', text: 'New bar on Langstrasse?' }),
      msg('0', { t: 'album.grant', album: 'a', name: 'Langstrasse pics', items: [] }),
    ];
    expect(findHits(list, 'langstrasse')).toEqual([0, 2, 3]);
    expect(findHits(list, null)).toEqual([]);
    expect(findText(msg('q', { t: 'quick_reply', text: 'Yes 🔥', k: 0 }).m)).toBeTruthy();
  });
});
