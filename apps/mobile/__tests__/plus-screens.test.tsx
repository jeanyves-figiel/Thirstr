// F-23 (#318): Plus screen states, Settings › Plus, limit card upsell rules (R-23.7, R-23.16).
import { beforeEach, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

let mockMe: Record<string, unknown> = {};
const mockNavigate = jest.fn();
jest.mock('../src/app/session', () => ({ useSession: () => ({ me: mockMe, refresh: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { PlusScreen, PlusSettingsScreen } = require('../src/plus/PlusScreen') as typeof import('../src/plus/PlusScreen');
const { PlusLimit } = require('../src/plus/PlusLimit') as typeof import('../src/plus/PlusLimit');
const { plxEn } = require('../src/i18n/plus') as typeof import('../src/i18n/plus');

const old = '2026-01-01T00:00:00Z';
const nav = { goBack: jest.fn(), navigate: jest.fn() };

beforeEach(() => mockNavigate.mockClear());

test('beta: everyone has Plus, no prices, pledge shown', async () => {
  mockMe = { plus: { active: true, source: 'beta' }, created_at: old };
  await render(<PlusScreen navigation={nav} />);
  expect(screen.getByText(plxEn.titleBeta)).toBeTruthy();
  expect(screen.getByTestId('plus-pledge')).toBeTruthy();
  expect(screen.queryByTestId('plus-soon')).toBeNull();
  expect(screen.queryByText(/€/)).toBeNull();
});

test('billing on, Free: says when Plus opens (prices only ever come from the store)', async () => {
  mockMe = { plus: { active: false, source: 'none' }, created_at: old };
  await render(<PlusScreen navigation={nav} />);
  expect(screen.getByText(plxEn.title)).toBeTruthy();
  expect(screen.getByTestId('plus-soon')).toBeTruthy();
});

test('Settings › Plus shows the source and the store link only when bought', async () => {
  mockMe = { plus: { active: true, source: 'safe_mode' } };
  await render(<PlusSettingsScreen navigation={nav} />);
  expect(screen.getByText(plxEn.state.safe_mode)).toBeTruthy();
  expect(screen.queryByTestId('plus-manage')).toBeNull();
});

test('Settings › Plus: a store subscription gets Manage subscription', async () => {
  mockMe = { plus: { active: true, source: 'store', renews_at: '2027-11-22T00:00:00Z' } };
  await render(<PlusSettingsScreen navigation={nav} />);
  expect(screen.getByTestId('plus-manage')).toBeTruthy();
});

const hit = { limit: 'tonight_active', free: 1, plus: 3, next_at: null, message: 'max 3 active plans' };

test('limit card: Free after 3 days gets See Plus', async () => {
  mockMe = { plus: { active: false, source: 'none' }, created_at: old };
  await render(<PlusLimit hit={hit} />);
  expect(screen.getByText(plxEn.limit.tonight_active.t)).toBeTruthy();
  expect(screen.getByTestId('plus-limit-see')).toBeTruthy();
});

test('limit card: no Plus prompt in the first 3 days (R-23.7)', async () => {
  mockMe = { plus: { active: false, source: 'none' }, created_at: new Date().toISOString() };
  await render(<PlusLimit hit={hit} />);
  expect(screen.getByText(plxEn.limit.tonight_active.t)).toBeTruthy();
  expect(screen.queryByTestId('plus-limit-see')).toBeNull();
});

test('limit card: a Plus member at the Plus cap sees the plain message, no upsell', async () => {
  mockMe = { plus: { active: true, source: 'beta' }, created_at: old };
  await render(<PlusLimit hit={hit} />);
  expect(screen.getByText('max 3 active plans')).toBeTruthy();
  expect(screen.queryByTestId('plus-limit-see')).toBeNull();
});
