# F-03 Verification

## Purpose
Prove "real human, 18+, matches photos" without storing identity. Primary anti-bot gate.

## Rules
- R-03.1 Liveness runs **on device**: randomized 3-step challenge from server nonce (turn left/right, smile, look up; blink dropped, #131: too rarely caught on still photos). Passive deepfake/injection detection (camera stream integrity, App Attest/Play Integrity).
  - R-03.1a (#131) iOS: Apple Vision face rectangles revision 3 (continuous yaw/pitch), nose-landmark pose as fallback, image orientation fallback. Each step keeps sampling frames for up to 6 s until the move is seen, then shows a ✓. If no face is found at the start (baseline), the app says so and the attempt does not count toward R-03.10.
- R-03.2 Photo match on device (#232): the selfie must match the user's own public photos. Model: SFace in Core ML, shared with the video check (R-18.15, D-22), same threshold (cosine ≥ 0.40).
  - R-03.2a When: right after the liveness moves pass. The prompt says "Look at the camera" once more; the app keeps that frontal still and the baseline still (R-03.1a), then shows "Checking against your photos…".
  - R-03.2b Against what: the largest face in each own public photo that is not rejected (main photo first, pending ones included, at most 6), loaded fresh from `GET /me` (presigned URLs, in memory only, ephemeral session, no cache).
  - R-03.2c Verdict: **both** stills must reach the threshold against at least one photo (with up to 6 photos per still, one lucky comparison is not enough).
    - Match → pass, verified.
    - No own photo shows a face → pass, verified without a photo-match claim (the badge stays "Verified").
    - No match → counts as a failed try (R-03.10). Message: "Your face doesn't match your photos. Your main photo should clearly show you. N tries left today."
    - A still shows no face → "Couldn't see your face…", no try spent.
    - No photo with a face and at least one photo failed to load → "Couldn't load your photos to compare. Check your connection…", no try spent (blocking downloads must not skip the match).
  - R-03.2d Privacy: stills are written to the app cache only for the match (front camera, quality 0.6) and deleted right after, whatever the result; embeddings, crops and scores stay in memory; only the existing `passed` boolean reaches the server (AC-03.1). The server API does not change.
  - R-03.2e iOS builds without the model (`matchStills` missing) skip the match; the server takes the device verdict as before (beta-build-plan, #11).
- R-03.3 Age estimation on device; if estimate < 23 → require second method: third-party zero-retention age check (boolean only) per jurisdiction.
- R-03.4 Result → client blinds a token → server signs (blind signature, RSA-BSSA RFC 9474) after verifying signed liveness result + attestation → client unblinds → redeems. Server learns "this account is verified" but cannot link the liveness session data (none stored) to anything else.
- R-03.5 Face templates and images never leave the device; deleted after check.
- R-03.6 Duplicate-human control: device computes a salted, locality-sensitive face hash; server stores only HMAC(LSH) buckets of banned accounts to block re-registration of banned users. Normal users' hashes are not stored.
- R-03.7 Re-verification required when main photo changes face materially, every 12 months, or on moderation request.
- R-03.8 Unlocks: appear in grid/map/Tonight/venues, start chats, post Now/Tonight/parties/activities, Hidden mode, exact pin, vouch.
- R-03.9 Unverified: browse grid/map (cards only, no distance < 1 km), read profiles, reply to messages received.
- R-03.10 3 failed attempts → 24 h cooldown + manual review option (video call with trust & safety, opt-in, nothing recorded).

## States
`unverified → challenge → passed → verified (epoch n) → expired → re-verify`.

## Acceptance criteria
- AC-03.1 Network capture shows no image/video/biometric template leaving device.
- AC-03.2 Unverified account cannot POST /mls/messages to a profile that hasn't messaged it (403 not_verified).
- AC-03.3 Replay of a used nonce fails.
- AC-03.5 (#232) A user whose public photos show someone else fails the check after the liveness moves (counts a try); a user whose photos show no face passes; with photos blocked from loading, no try is spent and no pass is given.
- AC-03.4 Banned user re-verifying on new account with same face is blocked ≥ 95 % in test set.
