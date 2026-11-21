import { api } from '../api/client';
import * as E from '../chat/engine';
import type { ClubDetail, Party } from './types';

type M = { id: string; name: string };

/** Current member list for a group context, as the server sees it (party guests, RSVPs, club members). */
async function membersOf(ctx: string): Promise<M[] | null> {
  const [kind, id] = ctx.split(':');
  if (kind === 'party') {
    const p = await api<Party>('GET', `/parties/${id}`);
    if (p.my_state !== 'host') return null;
    const guests = (p.requests ?? []).filter((r) => r.state === 'accepted').map((r) => ({ id: r.profile.id, name: r.profile.display_name }));
    return [{ id: p.host.id, name: p.host.display_name }, ...guests];
  }
  if (kind === 'activity') {
    const r = await api<{ members: { id: string; display_name: string }[] }>('GET', `/activities/${id}/members`);
    return r.members.map((m) => ({ id: m.id, name: m.display_name }));
  }
  if (kind === 'club') {
    const c = await api<ClubDetail>('GET', `/clubs/${id}`);
    return (c.member_list ?? []).filter((m) => m.state === 'member').map((m) => ({ id: m.profile.id, name: m.profile.display_name }));
  }
  return null;
}

let running: Promise<void> | null = null;

/** Host side: keep every group chat I run in step with its member list (accept, RSVP, leave, remove). */
export function resyncHostGroups(): Promise<void> {
  running ??= (async () => {
    for (const c of E.getConvs().filter((x) => x.ctx && x.host)) {
      try {
        const list = await membersOf(c.ctx!);
        if (list) await E.syncGroup(c.id, list);
      } catch {
        // ended party / deleted activity: keep the chat as it is
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
