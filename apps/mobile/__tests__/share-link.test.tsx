// #8 I-02 / S-80: Share sheet creates, copies the bare link, renews behind a confirm, and sends a phone-made preview.
import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

const mockApi = jest.fn<(m: string, p: string, b?: unknown) => Promise<unknown>>();
jest.mock('../src/api/client', () => ({ api: (m: string, p: string, b?: unknown) => mockApi(m, p, b) }));
const mockCopy = jest.fn<(s: string) => Promise<boolean>>(() => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => mockCopy(s) }));
jest.mock('../src/me/share/preview', () => ({
  approvedMain: (ph: { status: string }[]) => ph.find((p) => p.status === 'ok_main') ?? null,
  syncPreview: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../src/ui/Toast', () => ({ toast: jest.fn() }));
jest.mock('../src/ui', () => ({
  ...(jest.requireActual('../src/ui') as object),
  Sheet: ({ children }: { children: React.ReactNode }) => children,
}));

const { ShareSheet } = require('../src/me/share/ShareSheet') as typeof import('../src/me/share/ShareSheet');
const { syncPreview } = require('../src/me/share/preview') as { syncPreview: jest.Mock };
const { slEn, slFr, slDe } = require('../src/i18n/shareLink') as typeof import('../src/i18n/shareLink');

const on = { slug: 'k7m2qx9fha', url: 'https://thirstr.fun/p/k7m2qx9fha', short: 'thirstr.fun/p/k7m2qx9fha', show_photo: true, has_preview: false };
const photos = [{ id: 'ph1', status: 'ok_main', thumb_url: 'https://x/t.jpg' }];

beforeEach(() => {
  mockApi.mockReset();
  mockCopy.mockClear();
  syncPreview.mockClear();
});

test('no link: create, then the preview is sent', async () => {
  mockApi.mockImplementation((m) => Promise.resolve(m === 'GET' ? { share: null } : on));
  await render(<ShareSheet visible profileId="p1" name="Malik" photos={photos} onClose={() => {}} />);
  await act(async () => {
    await fireEvent.press(await screen.findByTestId('share-create'));
  });
  expect(mockApi).toHaveBeenCalledWith('POST', '/me/profiles/p1/share', undefined);
  expect(await screen.findByTestId('share-url')).toHaveTextContent('thirstr.fun/p/k7m2qx9fha');
  expect(syncPreview).toHaveBeenCalledWith('p1', photos[0]);
});

test('copy gives the bare form; renew needs a confirm', async () => {
  mockApi.mockImplementation((m) => Promise.resolve(m === 'GET' ? { share: { ...on, has_preview: true } } : { ...on, slug: 'zzzzzzzzzz' }));
  await render(<ShareSheet visible profileId="p1" name="Malik" photos={photos} onClose={() => {}} />);
  await act(async () => {
    await fireEvent.press(await screen.findByTestId('share-copy'));
  });
  expect(mockCopy).toHaveBeenCalledWith('thirstr.fun/p/k7m2qx9fha');
  await act(async () => {
    await fireEvent.press(screen.getByTestId('share-renew'));
  });
  expect(mockApi).not.toHaveBeenCalledWith('POST', '/me/profiles/p1/share', undefined);
  await act(async () => {
    await fireEvent.press(screen.getByTestId('share-confirm'));
  });
  expect(mockApi).toHaveBeenCalledWith('POST', '/me/profiles/p1/share', undefined);
  // renew drops the old preview, so a new one is sent
  expect(syncPreview).toHaveBeenCalledTimes(1);
});

test('no approved main photo: the photo switch is off and disabled', async () => {
  mockApi.mockResolvedValue({ share: on });
  await render(<ShareSheet visible profileId="p1" name="Malik" photos={[]} onClose={() => {}} />);
  const sw = await screen.findByTestId('share-photo');
  expect(sw.props.value).toBe(false);
  expect(screen.getByText(slEn.noPhoto)).toBeTruthy();
});

test('share strings exist in en, fr and de', () => {
  for (const s of [slEn, slFr, slDe]) for (const v of Object.values(s)) expect(String(v).length).toBeGreaterThan(0);
  expect(Object.keys(slFr).sort()).toEqual(Object.keys(slEn).sort());
  expect(Object.keys(slDe).sort()).toEqual(Object.keys(slEn).sort());
});
