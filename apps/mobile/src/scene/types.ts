import type { Distance } from '../api/types';

export type Person = {
  id: string;
  display_name: string;
  age: number;
  verified: boolean;
  photo: string | null;
  intent?: string | null;
  self?: boolean;
};

export type Plan = {
  id: string;
  profile: Person;
  distance: Distance;
  text: string;
  tag: string;
  audience: string;
  window_start: string;
  window_end: string;
};
export type MyPlan = {
  id: string;
  window_start: string;
  window_end: string;
  text: string;
  tag: string;
  audience: string;
  expires_at: string;
};

export type Party = {
  id: string;
  title: string;
  host: Person;
  starts_at: string;
  ends_at: string;
  capacity: number;
  seats_taken: number;
  rules: string[];
  audience: 'verified' | 'chats' | 'invite';
  status: 'open' | 'full' | 'live' | 'ended' | 'cancelled';
  area_cell: string;
  distance: Distance;
  my_state: null | 'host' | 'pending' | 'accepted' | 'not_this_time' | 'left';
  invite_code?: string | null;
  rating?: { up: number; total: number } | null;
  requests?: {
    profile: Person;
    state: 'pending' | 'accepted';
    at: string;
    vouches: number;
  }[];
};

export type Post = {
  id: string;
  host: Person;
  sport: string;
  title: string;
  place: string | null;
  starts_at: string;
  capacity: number | null;
  joined: number;
  audience: string;
  intent: string;
  club: { id: string; name: string } | null;
  distance: Distance;
  my_state: null | 'host' | 'joined' | 'removed';
};

export type Club = {
  id: string;
  name: string;
  sport: string;
  description: string | null;
  join_policy: 'open' | 'request';
  verified_club: boolean;
  members: number;
  my_state: null | 'member' | 'requested';
  my_role: null | 'member' | 'admin';
};

export type ClubDetail = Club & {
  events: {
    id: string;
    title: string;
    sport: string;
    starts_at: string;
    place: string | null;
  }[];
  member_list?: {
    profile: Person;
    role: 'member' | 'admin';
    state: 'member' | 'requested';
  }[];
};

export type Venue = {
  id: string;
  name: string;
  kind: string;
  geofence_radius_m: number;
  here: string;
  area_cell: string;
  distance: Distance;
  /** R-12.11 added by a member */
  member?: boolean;
};
export type Checkin = {
  venue_id: string;
  name: string;
  visible: boolean;
  zone: string | null;
  checked_in_at: string;
  auto_out_at: string;
};
export type Here = {
  venue: { id: string; name: string; kind: string; member?: boolean; mine?: boolean; removable?: boolean };
  me: { profile_id: string; visible: boolean };
  stats: { total: string; visible_to_you: number; tapped_you: number };
  people: {
    profile: Person;
    zone: string | null;
    since: string;
    tapped_me: boolean;
  }[];
};

export const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? time(iso) : `${d.toLocaleDateString([], { weekday: 'short' })} ${time(iso)}`;
};
