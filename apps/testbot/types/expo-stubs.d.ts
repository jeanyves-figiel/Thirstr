// Type-check only: the app's kv.ts is replaced by src/kv.ts in the bundle (build.mjs), but tsc
// still follows mls.ts → ./kv. These stubs stand in for the Expo modules it imports.
declare module 'expo-secure-store' {
  export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: number;
  export function getItemAsync(k: string): Promise<string | null>;
  export function setItemAsync(k: string, v: string, o?: object): Promise<void>;
}
declare module 'expo-sqlite' {
  export interface SQLiteDatabase {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, ...a: unknown[]): Promise<unknown>;
    getFirstAsync<T>(sql: string, ...a: unknown[]): Promise<T | null>;
    getAllAsync<T>(sql: string, ...a: unknown[]): Promise<T[]>;
    closeAsync(): Promise<void>;
  }
  export function openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
}
