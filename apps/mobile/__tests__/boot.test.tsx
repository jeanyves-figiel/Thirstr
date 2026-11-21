// Regressions for #88 / #90: the app must reach a real screen on launch, even when native
// safe-area insets never arrive or the keychain fails (blank screen on iPhone).
import { expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@maplibre/maplibre-react-native', () => ({ Camera: 'Camera', GeoJSONSource: 'GeoJSONSource', Layer: 'Layer', Map: 'Map', Marker: 'Marker' }));
jest.mock('expo-secure-store', () => {
  const fail = () => Promise.reject(new Error('Keychain unavailable'));
  return { getItemAsync: fail, setItemAsync: fail, deleteItemAsync: fail };
});

test('App reaches Welcome on launch even when the keychain fails', async () => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(() => Promise.reject(new Error('offline')));
  require('../src/crypto/setup');
  const App = (require('../App') as { default: React.ComponentType }).default;
  render(<App />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3200));
  });
  expect(screen.getByTestId('start')).toBeTruthy();
}, 20000);
