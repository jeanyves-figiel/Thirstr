// #213: every empty photo slot on Edit profile must open the picker, and a failed mockLaunch must show an error.
import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { color } from '../src/theme/tokens';

const mockLaunch = jest.fn<() => Promise<unknown>>();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: () => mockLaunch() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/api/photoUpload', () => ({ uploadPublicPhoto: jest.fn() }));
jest.mock('../src/ui/haptics', () => ({ feel: () => {} }));

const { PhotoEditor } = require('../src/me/PhotoEditor') as typeof import('../src/me/PhotoEditor');

const profile = {
  id: 'p1',
  photos: [{ id: 'a', slot: 0, status: 'approved', url: 'https://x/a.jpg', main_ok: true }],
} as unknown as Parameters<typeof PhotoEditor>[0]['profile'];

beforeEach(() => {
  mockLaunch.mockReset();
});

test('each of the 4 empty slots opens the picker', async () => {
  mockLaunch.mockResolvedValue({ canceled: true, assets: null });
  await render(<PhotoEditor profile={profile} accent={color.hookup} onChange={() => {}} />);
  const ids = ['photo-add', 'photo-add-2', 'photo-add-3', 'photo-add-4'];
  for (const id of ids) {
    await act(async () => {
      await fireEvent.press(screen.getByTestId(id));
    });
  }
  expect(mockLaunch).toHaveBeenCalledTimes(4);
});

test('a picker that fails to open shows an error, and the next tap works', async () => {
  mockLaunch.mockRejectedValueOnce(new Error('Picker unavailable')).mockResolvedValueOnce({ canceled: true, assets: null });
  await render(<PhotoEditor profile={profile} accent={color.hookup} onChange={() => {}} />);
  await act(async () => {
    await fireEvent.press(screen.getByTestId('photo-add-3'));
  });
  expect(screen.getByText('Picker unavailable')).toBeTruthy();
  await act(async () => {
    await fireEvent.press(screen.getByTestId('photo-add'));
  });
  expect(mockLaunch).toHaveBeenCalledTimes(2);
});
