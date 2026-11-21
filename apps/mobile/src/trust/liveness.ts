import type { FaceReading } from '../../modules/thirstr-face';

export type Step = 'turn_left' | 'turn_right' | 'blink' | 'smile' | 'look_up';

const eyes = (r: FaceReading) => ((r.leftEye ?? 0) + (r.rightEye ?? 0)) / 2;

/**
 * R-03.1 step check against the neutral baseline (#131 thresholds). Pose uses Vision's continuous
 * yaw/pitch, with a landmark fallback (nose tip vs eyes/lips) for phones where those read flat.
 */
export function passes(step: Step, base: FaceReading, r: FaceReading): boolean {
  if (r.faces < 1) return false;
  const d = (k: keyof FaceReading) => Math.abs(((r[k] as number) ?? 0) - ((base[k] as number) ?? 0));
  switch (step) {
    case 'turn_left':
    case 'turn_right':
      return d('yaw') >= 0.25 || (r.noseX != null && base.noseX != null && d('noseX') >= 0.12);
    case 'look_up':
      return d('pitch') >= 0.15 || (r.noseY != null && base.noseY != null && d('noseY') >= 0.1);
    case 'blink':
      return eyes(base) > 0 && eyes(r) < eyes(base) * 0.65;
    case 'smile':
      return (base.mouth ?? 0) > 0 && (r.mouth ?? 0) >= (base.mouth ?? 0) * 1.08;
  }
}
