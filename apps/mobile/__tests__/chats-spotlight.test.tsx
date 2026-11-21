// #211 S-40 Spotlight: full-width Taps button, typing line, Unread badge.
import { expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { color } from '../src/theme/tokens';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

const tap = (id: string, name: string, seen = false, mutual = false) => ({
  profile: { id, display_name: name, age: 30, verified: true, photo: null },
  at: new Date().toISOString(),
  seen,
  mutual,
  kind: 'now' as const,
});

test('Taps button names the unseen tappers and counts mutual ones', async () => {
  const { TapsButton } = require('../src/chat/TapsButton');
  await render(<TapsButton taps={[tap('a', 'Marco'), tap('b', 'Leo', false, true), tap('c', 'Sami'), tap('d', 'Old', true)]} onPress={() => {}} />);
  expect(screen.getByText('3 new Taps')).toBeTruthy();
  expect(screen.getByText('Marco, Leo and 1 more · 1 mutual')).toBeTruthy();
  expect(screen.getByTestId('inbox-taps').props.accessibilityRole).toBe('button');
});

test('Taps button without new taps invites to look', async () => {
  const { TapsButton } = require('../src/chat/TapsButton');
  await render(<TapsButton taps={[tap('d', 'Old', true)]} onPress={() => {}} />);
  expect(screen.getByText('Taps')).toBeTruthy();
  expect(screen.getByText('See who tapped you')).toBeTruthy();
});

test('Typing line falls back to the preview when nobody types', async () => {
  const { TypingLine } = require('../src/chat/TapsButton');
  await render(
    <TypingLine cid="me:peer" tint={color.friends}>
      <Text>last message</Text>
    </TypingLine>,
  );
  expect(screen.getByText('last message')).toBeTruthy();
});

test('Segmented shows a count badge and hides it at 0', async () => {
  const { Segmented } = require('../src/ui');
  await render(
    <Segmented
      label="Chats"
      value="all"
      onChange={() => {}}
      options={[
        { value: 'all', label: 'All', badge: 0 },
        { value: 'unread', label: 'Unread', badge: 3 },
      ]}
    />,
  );
  expect(screen.getByLabelText('Unread, 3')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByLabelText('All')).toBeTruthy();
});

test('fr / de Taps strings', async () => {
  const fr = require('../src/i18n/fr').fr ?? require('../src/i18n/fr').default;
  const de = require('../src/i18n/de').de ?? require('../src/i18n/de').default;
  expect(fr.chat.tapsTitle(2)).toBe('2 nouveaux Taps');
  expect(fr.chat.tapsWho(['A', 'B', 'C', 'D'], 2)).toBe('A, B et 2 autres · 2 mutuels');
  expect(de.chat.tapsTitle(1)).toBe('1 neuer Tap');
  expect(de.chat.tapsWho(['A', 'B'], 0)).toBe('A und B');
});
