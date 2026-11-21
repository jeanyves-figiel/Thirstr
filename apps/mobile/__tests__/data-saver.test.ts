// F-17 R-17.16 (#177): when Data saver is active.
import { expect, jest, test } from '@jest/globals';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { _setNet, active, fromState, saverSummary, saving, setMode, unmetered } from '../src/app/dataSaver';

const cell = { cellular: true, expensive: true, wifi: false };
const wifi = { cellular: false, expensive: false, wifi: true };
const metered = { cellular: false, expensive: true, wifi: true };

test('auto is on with mobile data and metered Wi-Fi, off on plain Wi-Fi', () => {
  expect(active('auto', cell)).toBe(true);
  expect(active('auto', metered)).toBe(true);
  expect(active('auto', wifi)).toBe(false);
});

test('always and off ignore the network', () => {
  expect(active('always', wifi)).toBe(true);
  expect(active('off', cell)).toBe(false);
});

test('reads NetInfo state', () => {
  expect(fromState({ type: 'cellular', details: { isConnectionExpensive: true } } as never)).toEqual(cell);
  expect(fromState({ type: 'wifi', details: { isConnectionExpensive: false } } as never)).toEqual(wifi);
  expect(fromState({ type: 'none', details: null } as never)).toEqual({ cellular: false, expensive: false, wifi: false });
});

test('mode and network drive saving() and the hub summary', async () => {
  _setNet(cell);
  expect(saving()).toBe(true); // default auto
  expect(unmetered()).toBe(false);
  _setNet(wifi);
  expect(saving()).toBe(false);
  expect(unmetered()).toBe(true);
  await setMode('always');
  expect(saving()).toBe(true);
  expect(saverSummary('auto', true)).toMatch(/Auto/);
  expect(saverSummary('off', false)).toBe('Off');
  await setMode('auto');
});
