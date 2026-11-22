// SR-10 (#150) + #305: one on-device encode (≤ 2048 px, JPEG, no EXIF), thumb from the same decode,
// native PUT, slot reserved while encoding; a failed thumbnail never blocks the photo.
import { beforeEach, expect, jest, test } from '@jest/globals';
const mockPuts: string[] = [];
const mockOrder: string[] = [];
jest.mock('../src/api/client', () => ({
  api: jest.fn(async () => {
    mockOrder.push('reserve');
    return { photo_id: 'p1', put_url: 'https://s3/full', thumb_put_url: 'https://s3/full-t', content_type: 'image/jpeg' };
  }),
  putBlob: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: jest.fn(async (url: string) => {
    mockPuts.push(url);
    return { status: 200 };
  }),
}));
const mockLoad = jest.fn();
const mockResize = jest.fn();
let mockThumbFail = false;
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (src: unknown, opts?: unknown) => {
      if (typeof src === 'string') mockLoad(src, opts);
      return {
        resize: mockResize,
        renderAsync: async () => {
          if (typeof src !== 'string' && mockThumbFail) throw new Error('decode');
          mockOrder.push(typeof src === 'string' ? 'encode' : 'thumb');
          return { saveAsync: async (o: { compress: number }) => ({ uri: typeof src === 'string' ? 'file://full.jpg' : 'file://thumb.jpg', o }) };
        },
      };
    },
  },
}));
const mockPick = jest.fn<(o: unknown) => Promise<unknown>>();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (o: unknown) => mockPick(o),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));

import { MAX_PX, pickPublicPhoto, uploadPublicPhoto } from '../src/api/photoUpload';

beforeEach(() => {
  mockPuts.length = 0;
  mockOrder.length = 0;
  mockThumbFail = false;
  mockLoad.mockClear();
});

test('encodes once at ≤ 2048 px and uploads photo + 480 px thumbnail natively', async () => {
  expect(await uploadPublicPhoto('prof', 0, 'file://a.heic')).toBe('p1');
  expect(mockLoad).toHaveBeenCalledWith('file://a.heic', { maxWidth: MAX_PX, maxHeight: MAX_PX });
  expect(mockLoad).toHaveBeenCalledTimes(1); // thumb reuses the decoded image
  expect(mockResize).toHaveBeenCalledWith({ width: 480 });
  expect(mockPuts.sort()).toEqual(['https://s3/full', 'https://s3/full-t']);
  expect(mockOrder[0]).toBe('reserve'); // reserved before the encode finishes
});

test('thumbnail failure still uploads the photo', async () => {
  mockThumbFail = true;
  expect(await uploadPublicPhoto('prof', 1, 'file://a.jpg')).toBe('p1');
  expect(mockPuts).toEqual(['https://s3/full']);
});

test('picker uses the fast system picker: no edit step, no re-encode', async () => {
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://x.heic', width: 4032, height: 3024 }] });
  expect(await pickPublicPhoto()).toEqual({ uri: 'file://x.heic', width: 4032, height: 3024 });
  expect(mockPick).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: false, quality: 1, exif: false, preferredAssetRepresentationMode: 'current' }));
  mockPick.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await pickPublicPhoto()).toBeNull();
});
