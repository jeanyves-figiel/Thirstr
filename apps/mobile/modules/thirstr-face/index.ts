import { requireOptionalNativeModule } from 'expo';

/** Face measurements from Apple Vision (iOS only). Numbers only; the photo stays on the device. */
export type FaceReading = { faces: number; yaw?: number; pitch?: number; roll?: number; size?: number; leftEye?: number; rightEye?: number; mouth?: number; noseX?: number; noseY?: number };

/**
 * F-18 R-18.15 (#185): video check face match. `photoFaces` = photos with a usable face; `frames` = per clip
 * frame, the best cosine similarity against those faces (−1 = no face in that frame). Computed on the phone;
 * no image, crop or embedding leaves it.
 */
export type ClipMatch = { photoFaces: number; frames: number[] };

type Native = { analyze(uri: string): Promise<FaceReading>; matchClip?(clipUri: string, photoUrls: string[]): Promise<ClipMatch>; faceBoxes?(uri: string): Promise<number[][]> };

const native = requireOptionalNativeModule<Native>('ThirstrFace');

export const faceAvailable = !!native;
export const analyzeFace = (uri: string): Promise<FaceReading> => (native ? native.analyze(uri) : Promise.reject(new Error('unavailable')));
export const faceMatchAvailable = !!native?.matchClip;
export const matchClip = (clipUri: string, photoUrls: string[]): Promise<ClipMatch> =>
  native?.matchClip ? native.matchClip(clipUri, photoUrls) : Promise.reject(new Error('unavailable'));

/** F-21 R-21.2 (#221): face boxes [x, y, w, h] (0…1, top-left origin, largest first) for "Blur faces". */
export const faceBoxesAvailable = !!native?.faceBoxes;
export const faceBoxes = (uri: string): Promise<number[][]> => (native?.faceBoxes ? native.faceBoxes(uri) : Promise.reject(new Error('unavailable')));
