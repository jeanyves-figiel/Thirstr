// R-04.13: Explore asks once for location and keeps the device fix on the device.
import { expect, jest, test } from '@jest/globals';
const perm = { status: 'undetermined', canAskAgain: true };
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ ...perm })),
  requestForegroundPermissionsAsync: jest.fn(async () => {
    perm.status = 'granted';
    return { ...perm };
  }),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { latitude: 47.37, longitude: 8.54 } })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 47.3769, longitude: 8.5417 } })),
}));
jest.mock('../src/api/client', () => ({ api: jest.fn() }));

import * as ExpoLocation from 'expo-location';
import { devicePosition, locateDevice, onDevicePosition } from '../src/explore/location';

test('asks once, then centres on the fresh device fix', async () => {
  const seen: { lat: number; lng: number }[] = [];
  const off = onDevicePosition((p) => seen.push(p));
  expect(await locateDevice()).toEqual({ lat: 47.3769, lng: 8.5417 });
  expect(seen).toEqual([
    { lat: 47.37, lng: 8.54 },
    { lat: 47.3769, lng: 8.5417 },
  ]);
  expect(devicePosition()).toEqual({ lat: 47.3769, lng: 8.5417 });
  await locateDevice();
  expect(ExpoLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  off();
});

test('denied permission is not asked again and gives no position', async () => {
  perm.status = 'denied';
  perm.canAskAgain = false;
  jest.mocked(ExpoLocation.requestForegroundPermissionsAsync).mockClear();
  expect(await locateDevice()).toBeNull();
  expect(ExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});
