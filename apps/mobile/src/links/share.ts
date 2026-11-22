// I-01 R-I01.2 / R-I01.22–23 (#17): send one shared post to up to 5 chats.
import * as E from '../chat/engine';
import { firstMessageProblem } from '../chat/rules';
import { adultAllowed, countAdult, countSends, dailyLeft, isAdult, linkHash, MAX_CHATS, type Platform } from './links';
import { toPayload, type Preview } from './preview';

export type ShareResult = { sent: number; failed: number; limited?: boolean; creatorNote?: boolean; asText?: boolean };

/** R-I01.22: a chat can take a link card only once the other side replied (R-07.3); groups always. */
export const canShareTo = (c: E.Conv) => !c.gone && (!!c.ctx || firstMessageProblem(c, { t: 'link.preview', url: '', host: '', platform: 'web' }) === null);

export async function shareTo(cids: string[], p: Preview, text: string, safeMode: boolean): Promise<ShareResult> {
  const targets = cids.slice(0, MAX_CHATS).map(E.getConv).filter((c): c is E.Conv => !!c && canShareTo(c));
  if (!targets.length) return { sent: 0, failed: 0 };
  // R-I01.28 / R-I01.30: adult links go as plain text in Safe Mode or on the store-review build.
  if (isAdult(p.platform as Platform) && !adultAllowed(safeMode)) {
    let sent = 0;
    for (const c of targets) {
      await E.send(c.id, { t: 'text', text: [text.trim(), p.url].filter(Boolean).join(' ') }).then(() => sent++, () => {});
    }
    return { sent, failed: targets.length - sent, asText: true };
  }
  if ((await dailyLeft()) < targets.length) return { sent: 0, failed: 0, limited: true };
  const payload = await toPayload(p, text);
  const lh = await linkHash(p.url);
  let sent = 0;
  let failed = 0;
  for (const c of targets) {
    try {
      await E.send(c.id, payload, { lh });
      sent++;
    } catch {
      failed++;
    }
  }
  await countSends(sent);
  const creatorNote = isAdult(p.platform as Platform) ? await countAdult(sent) : false;
  return { sent, failed, creatorNote };
}
