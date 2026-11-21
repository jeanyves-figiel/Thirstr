// Web (DEV) has no camera roll: the tray shows only "Pick from library" (R-08.12).
export type Access = 'all' | 'limited' | 'none' | 'undetermined';
export type Shot = { id: string; uri: string; w: number; h: number; video?: boolean; dur?: number };
export const available = false;
export const current = async (): Promise<Access> => 'none';
export const ask = async (): Promise<Access> => 'none';
export const manage = async (_a: Access) => {};
export const page = async (_after?: string): Promise<{ items: Shot[]; next?: string }> => ({ items: [] });
export const fileUri = async (s: Shot) => s.uri;
export const onChange = (_fn: () => void) => () => {};
