// SR-10 (#150): photo + 480 px thumbnail; a failed thumbnail never blocks the photo.
import { beforeEach, expect, jest, test } from '@jest/globals';
const mockCalls: string[] = [];
jest.mock('../src/api/client', () => ({
  api: jest.fn(async () => ({ photo_id: 'p1', put_url: 'https://s3/full', thumb_put_url: 'https://s3/full-t', content_type: 'image/jpeg' })),
  putBlob: jest.fn(async (url: string) => {
    mockCalls.push(url);
  }),
}));
const mockResize = jest.fn();
let mockFail = false;
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: mockResize,
      renderAsync: async () => {
        if (mockFail) throw new Error('decode');
        return { saveAsync: async () => ({ uri: 'file://thumb.jpg' }) };
      },
    }),
  },
}));

import { uploadPublicPhoto } from '../src/api/photoUpload';

beforeEach(() => {
  mockCalls.length = 0;
  mockFail = false;
});

test('uploads the photo and a 480 px thumbnail', async () => {
  expect(await uploadPublicPhoto('prof', 0, 'file://a.jpg', 'image/jpeg')).toBe('p1');
  expect(mockCalls.sort()).toEqual(['https://s3/full', 'https://s3/full-t']);
  expect(mockResize).toHaveBeenCalledWith({ width: 480 });
});

test('thumbnail failure still uploads the photo', async () => {
  mockFail = true;
  expect(await uploadPublicPhoto('prof', 1, 'file://a.jpg', 'image/jpeg')).toBe('p1');
  expect(mockCalls).toEqual(['https://s3/full']);
});
