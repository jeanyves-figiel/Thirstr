import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// #260: OS background chat backup. Task body order and registration follow the switch.
const mockCalls: string[] = [];
let mockOn = false;
const mockRegistered = new Set<string>();

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-task-manager', () => ({
  isTaskDefined: () => false,
  defineTask: () => {},
  isTaskRegisteredAsync: async (n: string) => mockRegistered.has(n),
}));
jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: async () => 2,
  registerTaskAsync: async (n: string, o: { minimumInterval: number }) => {
    mockRegistered.add(n);
    mockCalls.push('register:' + o.minimumInterval);
  },
  unregisterTaskAsync: async (n: string) => {
    mockRegistered.delete(n);
    mockCalls.push('unregister');
  },
}));
jest.mock('../src/app/dataSaver', () => ({ refreshNetwork: async () => void mockCalls.push('net') }));
jest.mock('../src/chat/engine', () => ({ loadConvsOnly: async () => void mockCalls.push('convs') }));
jest.mock('../src/chat/backup', () => ({
  prefs: async () => ({ on: mockOn, cellular: false }),
  backupIfDue: async () => void mockCalls.push('backup'),
}));

import * as G from '../src/chat/backgroundBackup';

beforeEach(() => {
  mockCalls.length = 0;
});

describe('#260 background chat backup', () => {
  it('reads the network and the chat list before the run', async () => {
    expect(await G.runInBackground()).toBe(1);
    expect(mockCalls).toEqual(['net', 'convs', 'backup']);
  });

  it('registers daily only while Chat backup is on', async () => {
    mockOn = true;
    await G.syncBackgroundBackup();
    await G.syncBackgroundBackup();
    expect(mockCalls).toEqual(['register:1440']);
    mockOn = false;
    await G.syncBackgroundBackup();
    expect(mockCalls).toEqual(['register:1440', 'unregister']);
  });
});
