// F-17 R-17.15 (#238): the card opens once over a quiet Explore, waits otherwise, and stays local.
import { expect, jest, test, beforeEach } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));

jest.mock('react-native-gesture-handler', () => ({ usePanGesture: () => ({}), GestureDetector: ({ children }: { children: React.ReactNode }) => children }));

// The real Sheet needs the native pan gesture; render its content when visible.
jest.mock('../src/ui', () => {
  const actual = jest.requireActual('../src/ui') as object;
  const { View } = require('react-native');
  return { ...actual, afterSheet: (fn: () => void) => fn(), Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <View>{children}</View> : null) };
});

const { WhatsNewCard, SEEN_KEY } = require('../src/whatsnew/WhatsNew');
const { NOTES } = require('../src/whatsnew/notes');
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

test('fresh install: no card, newest note marked seen', async () => {
  await render(<WhatsNewCard ready onOpen={() => {}} onHistory={() => {}} />);
  await flush();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
  expect(await AsyncStorage.getItem(SEEN_KEY)).toBe(String(NOTES[0].id));
});

test('upgrade: card waits for a quiet Explore, tap opens the full list, Got it marks seen', async () => {
  await AsyncStorage.setItem('thirstr.prefs', '{}');
  const r = await render(<WhatsNewCard ready={false} onOpen={() => {}} onHistory={() => {}} />);
  await flush();
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
  await r.rerender(<WhatsNewCard ready onOpen={() => {}} onHistory={() => {}} />);
  await act(async () => { jest.advanceTimersByTime(1300); });
  expect(screen.getByTestId('whats-new-card')).toBeTruthy();
  expect(screen.queryByTestId('whats-new')).toBeNull();
  await fireEvent.press(screen.getByTestId('whats-new-more'));
  await flush();
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
  expect(screen.getByTestId('whats-new')).toBeTruthy();
  expect(await AsyncStorage.getItem(SEEN_KEY)).toBeNull();
  await fireEvent.press(screen.getByTestId('whats-new-ok'));
  await flush();
  expect(await AsyncStorage.getItem(SEEN_KEY)).toBe(String(NOTES[0].id));
  expect(screen.queryByTestId('whats-new')).toBeNull();
});

test('card closes on its own after 12 s and counts as seen', async () => {
  await AsyncStorage.setItem('thirstr.prefs', '{}');
  await render(<WhatsNewCard ready onOpen={() => {}} onHistory={() => {}} />);
  await flush();
  await act(async () => { jest.advanceTimersByTime(1300); });
  expect(screen.getByTestId('whats-new-card')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(12100); });
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
  expect(await AsyncStorage.getItem(SEEN_KEY)).toBe(String(NOTES[0].id));
});

test('card hides (not dismissed) when Explore stops being quiet, ✕ dismisses', async () => {
  await AsyncStorage.setItem('thirstr.prefs', '{}');
  const r = await render(<WhatsNewCard ready onOpen={() => {}} onHistory={() => {}} />);
  await flush();
  await act(async () => { jest.advanceTimersByTime(1300); });
  await r.rerender(<WhatsNewCard ready={false} onOpen={() => {}} onHistory={() => {}} />);
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
  expect(await AsyncStorage.getItem(SEEN_KEY)).toBeNull();
  await r.rerender(<WhatsNewCard ready onOpen={() => {}} onHistory={() => {}} />);
  await act(async () => { jest.advanceTimersByTime(1300); });
  await fireEvent.press(screen.getByTestId('whats-new-close'));
  await flush();
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
  expect(await AsyncStorage.getItem(SEEN_KEY)).toBe(String(NOTES[0].id));
});

test('already seen: nothing', async () => {
  await AsyncStorage.setItem('thirstr.prefs', '{}');
  await AsyncStorage.setItem(SEEN_KEY, String(NOTES[0].id));
  await render(<WhatsNewCard ready onOpen={() => {}} onHistory={() => {}} />);
  await flush();
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(screen.queryByTestId('whats-new-card')).toBeNull();
});
