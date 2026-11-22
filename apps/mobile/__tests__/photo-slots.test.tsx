// #213 + #305: every empty photo slot on Edit profile must open the picker, and a failed mockLaunch must show an error.
import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { color } from '../src/theme/tokens';

const mockLaunch = jest.fn<() => Promise<unknown>>();
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockUpload = jest.fn<() => Promise<string>>();
jest.mock('../src/api/photoUpload', () => ({ pickPublicPhoto: () => mockLaunch(), uploadPublicPhoto: () => mockUpload() }));
const mockApi = jest.fn<(m: string, path: string) => Promise<unknown>>();
jest.mock('../src/api/client', () => ({ api: (m: string, p: string) => mockApi(m, p), ApiError: class extends Error {} }));
jest.mock('../src/ui/haptics', () => ({ feel: () => {} }));

const { PhotoEditor } = require('../src/me/PhotoEditor') as typeof import('../src/me/PhotoEditor');

const profile = {
  id: 'p1',
  photos: [{ id: 'a', slot: 0, status: 'approved', url: 'https://x/a.jpg', main_ok: true }],
} as unknown as Parameters<typeof PhotoEditor>[0]['profile'];

beforeEach(() => {
  mockLaunch.mockReset();
  mockUpload.mockReset();
  mockApi.mockReset();
});

test('each of the 4 empty slots opens the picker', async () => {
  mockLaunch.mockResolvedValue(null);
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
  mockLaunch.mockRejectedValueOnce(new Error('Picker unavailable')).mockResolvedValueOnce(null);
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

test('#305: a filled photo tile is absolute fill (no % height that grows with the ScrollView)', async () => {
  await render(<PhotoEditor profile={profile} accent={color.hookup} onChange={() => {}} />);
  const tile = screen.getByTestId('photo-0');
  const flat = (x: unknown): Record<string, unknown> => (Array.isArray(x) ? Object.assign({}, ...x.map(flat)) : ((x as Record<string, unknown>) ?? {}));
  const inner = flat((tile.children[0] as unknown as { props: { style: unknown } }).props.style);
  expect(inner.position).toBe('absolute');
  expect(inner.height).toBeUndefined();
});

test('#305: picked photo shows at once, then the account from the check is used (no reload)', async () => {
  let finish!: (v: string) => void;
  mockLaunch.mockResolvedValue({ uri: 'file://local.jpg' });
  mockUpload.mockReturnValue(new Promise<string>((r) => (finish = r)));
  const fresh = { ...profile, photos: [...(profile.photos as object[]), { id: 'b', slot: 1, status: 'ok_public', url: 'https://x/b.jpg' }] };
  mockApi.mockResolvedValue({ photo: {}, account: { profile: fresh, profiles: [fresh] } });
  const onChange = jest.fn();
  await render(<PhotoEditor profile={profile} accent={color.hookup} onChange={onChange} />);
  await act(async () => {
    await fireEvent.press(screen.getByTestId('photo-add'));
  });
  expect(screen.getByTestId('photo-uploading')).toBeTruthy();
  await act(async () => {
    finish('ph1');
  });
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(mockApi.mock.calls[0][1]).toBe('/me/profiles/p1/photos/ph1/check');
  expect(onChange).toHaveBeenCalledWith(fresh);
  expect(screen.queryByTestId('photo-uploading')).toBeNull();
});
