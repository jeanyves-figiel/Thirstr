// F-18 R-18.15 (#185): verdict of the video check face match. The phone compares 3 frames of the clip with
// the largest face in each of the peer's public photos (SFace, Core ML, on device) and hands back one
// similarity per frame. Nothing here is stored or sent.
import type { ClipMatch, StillMatch } from '../../modules/thirstr-face';
import type { Photo } from '../api/client';

/** Cosine similarity for "same person". OpenCV's LFW threshold for SFace is 0.363; a bit stricter here. */
export const MATCH_AT = 0.4;
/** Frames that must show a face, and frames that must match. */
export const MIN_FACE_FRAMES = 2;
export const MIN_MATCH_FRAMES = 2;
/** Main photo + up to 5 public photos (R-05). */
export const MAX_PHOTOS = 6;

export type Verdict = 'match' | 'nomatch' | null;

/** null = show nothing (no photo with a face, or too few frames with a face). */
export function verdict(m: ClipMatch | null | undefined): Verdict {
  if (!m || m.photoFaces < 1) return null;
  const faces = m.frames.filter((s) => s >= 0);
  if (faces.length < MIN_FACE_FRAMES) return null;
  return faces.filter((s) => s >= MATCH_AT).length >= MIN_MATCH_FRAMES ? 'match' : 'nomatch';
}

/** Public photo URLs to compare against, main photo first, https only. */
export const photoTargets = (photos: (string | null | undefined)[]): string[] =>
  photos.filter((u): u is string => typeof u === 'string' && u.startsWith('https://')).slice(0, MAX_PHOTOS);

// F-03 R-03.2 (#232): selfie verification photo match. Two frontal stills of the liveness check (the
// baseline and one taken after the last move) vs the largest face in each of the user's own public
// photos, same model and threshold as the video check (D-22). Both stills must match: with up to 6
// photos per still, one lucky comparison is not enough.
export const SELFIE_STILLS = 2;

/**
 * pass        = matches, or no own photo shows a face (verified without a photo-match claim)
 * nomatch     = counts as a failed try (R-03.10)
 * noface      = a still shows no face: ask again, no try spent
 * offline     = own photos didn't load: ask again, no try spent (blocking downloads must not skip the match)
 */
export type SelfieOutcome = 'pass' | 'nomatch' | 'noface' | 'offline';

export function selfieOutcome(m: StillMatch): SelfieOutcome {
  if (m.photoFaces < 1) return m.photoErrors > 0 ? 'offline' : 'pass';
  if (m.frames.length < SELFIE_STILLS || m.frames.some((s) => s < 0)) return 'noface';
  return m.frames.every((s) => s >= MATCH_AT) ? 'pass' : 'nomatch';
}

/** Own photos to compare against: not rejected, main slot first, https only, at most 6. */
export const ownPhotoTargets = (photos: Photo[] | null | undefined): string[] =>
  photoTargets(
    (photos ?? [])
      .filter((p) => p.status !== 'rejected')
      .sort((a, b) => a.slot - b.slot)
      .map((p) => p.url),
  );
