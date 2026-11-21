// F-08 R-08.12 camera roll for the media tray: photos and videos (#138, R-08.17). Thumbnails are read by the
// OS image loader straight from the library; nothing leaves the phone until it is sent.
import * as ML from 'expo-media-library/legacy';
import { Linking, Platform } from 'react-native';

export type Access = 'all' | 'limited' | 'none' | 'undetermined';
/** `video` + `dur` (s) for videos (#138). */
export type Shot = { id: string; uri: string; w: number; h: number; video?: boolean; dur?: number };

export const available = true;
const KINDS: ML.GranularPermission[] = ['photo', 'video'];

function access(p: ML.PermissionResponse): Access {
  if (p.status === 'undetermined') return 'undetermined';
  if (!p.granted) return 'none';
  return p.accessPrivileges === 'limited' ? 'limited' : 'all';
}

export async function current(): Promise<Access> {
  return access(await ML.getPermissionsAsync(false, KINDS));
}

export async function ask(): Promise<Access> {
  return access(await ML.requestPermissionsAsync(false, KINDS));
}

/** iOS limited access: the system "selected photos" picker; otherwise app settings. */
export async function manage(a: Access) {
  if (a === 'limited' && Platform.OS === 'ios') return ML.presentPermissionsPickerAsync(['photo', 'video']);
  return Linking.openSettings();
}

export async function page(after?: string): Promise<{ items: Shot[]; next?: string }> {
  const r = await ML.getAssetsAsync({ first: 60, after, mediaType: [ML.MediaType.photo, ML.MediaType.video], sortBy: [[ML.SortBy.creationTime, false]] });
  return {
    items: r.assets.map((a) => ({ id: a.id, uri: a.uri, w: a.width, h: a.height, ...(a.mediaType === ML.MediaType.video ? { video: true, dur: a.duration } : {}) })),
    next: r.hasNextPage ? r.endCursor : undefined,
  };
}

/** A file URI the re-encoder / video scrubber can read (iOS ph:// → local file, downloads from iCloud if needed). */
export async function fileUri(s: Shot): Promise<string> {
  const info = await ML.getAssetInfoAsync(s.id, { shouldDownloadFromNetwork: true });
  return info.localUri ?? s.uri;
}

export const onChange = (fn: () => void) => {
  const sub = ML.addListener(() => fn());
  return () => sub.remove();
};
