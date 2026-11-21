import { privateStore as AsyncStorage } from '../app/privateStore';

// R-06.6: values set to "My chats" / "Only me" never reach the server. They stay on this device
// and are shared E2EE with chat partners (B2 chat attaches them to the profile card message).
const KEY = (pid: string) => 'thirstr.localFields.' + pid;

export async function getLocal(pid: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY(pid))) ?? '{}');
  } catch {
    return {};
  }
}

export async function setLocal(pid: string, v: Record<string, unknown>) {
  await AsyncStorage.setItem(KEY(pid), JSON.stringify(v));
}
