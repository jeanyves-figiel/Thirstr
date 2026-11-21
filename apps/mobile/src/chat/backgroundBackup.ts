// #260 (F-01 R-01.15): the daily chat backup also runs as an OS background task (iOS
// BGProcessingTask, Android WorkManager), so it happens even on days the app isn't opened.
// The OS picks the moment (usually overnight, on power); we still require Wi-Fi unless the user
// allowed mobile data, and the same once-a-day gate as the foreground run.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { refreshNetwork } from '../app/dataSaver';
import * as B from './backup';
import * as E from './engine';

export const TASK = 'thirstr-chat-backup';
const native = Platform.OS === 'ios' || Platform.OS === 'android';

/** The task body: no UI, no socket; reads the encrypted store and uploads sealed segments. */
export async function runInBackground(): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    await refreshNetwork(); // the foreground listener isn't running in a background launch
    await E.loadConvsOnly();
    await B.backupIfDue();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

// Must be defined at module load (index.ts imports this file) so a background launch finds it.
if (native && !TaskManager.isTaskDefined(TASK)) TaskManager.defineTask(TASK, runInBackground);

/** Keeps the OS registration in line with the Chat backup switch (app start, switch change). */
export async function syncBackgroundBackup() {
  if (!native) return;
  try {
    const on = (await B.prefs()).on;
    const has = await TaskManager.isTaskRegisteredAsync(TASK);
    if (on && !has) {
      if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 24 * 60 });
    } else if (!on && has) await BackgroundTask.unregisterTaskAsync(TASK);
  } catch {
    // background tasks restricted (Low Power Mode, Background App Refresh off): foreground runs only
  }
}
