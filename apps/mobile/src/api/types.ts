// Response shapes (docs/spec/api.md). Account ids never appear.
import type { Photo } from './client';
import type { MomentsBadge } from '../moments/api';

export type Mode = 'hookup' | 'friends' | 'sport';
export type Kind = 'now' | 'sport' | 'friends';
export const kindForMode: Record<Mode, Kind> = { hookup: 'now', sport: 'sport', friends: 'friends' };

export type Visibility = 'public' | 'verified' | 'chats' | 'only_me';

export type MyProfile = {
  id: string;
  kind: Kind;
  display_name: string;
  age: number;
  gender: string;
  gender_other: string | null;
  here_for: string[];
  /** F-06 R-06.1a: lenses this profile appears in. */
  show_in: Mode[];
  fields: Record<string, unknown>;
  visibility_map: Record<string, Visibility>;
  completeness: number;
  photos: Photo[];
};

export type NowStatus = { status: 'now' | 'hosting' | 'can_travel' | 'door_open'; text: string | null; since?: string; expires_at?: string; fresh?: boolean };

/** #197 R-04.6: area carries a rounded `m` (approx; `floor` = "< m"), absent under range-only or the spoof brake; `bucket` stays for old builds. */
export type Distance =
  | null
  | { kind: 'exact'; m: number }
  | { kind: 'area'; bucket: string; m?: number; floor?: boolean; approx?: boolean; precise?: boolean }
  | { kind: 'city'; city: string | null };

export type Card = {
  id: string;
  display_name: string;
  age: number;
  verified: boolean;
  photo: string | null;
  online: boolean;
  distance: Distance;
  now: NowStatus | null;
  exact: boolean;
  pin_expires_at: string | null;
  further: boolean;
  creator: boolean;
  intent: string | null;
  position: string | null;
  new: boolean;
  lat?: number;
  lng?: number;
  /** R-04.19 (#113): his `show_in`, ordered hookup → friends → sport. */
  intents?: Mode[];
  /** F-20 R-20.13: listed because of a trip (no distance). */
  visitor?: boolean;
  trip?: VisitorTrip | null;
  /** F-21 R-21.27 (#212): ring data, null when he has no Moment I may see. */
  moments?: MomentsBadge;
};

/** F-20: what others see of a shown trip (never his position or other trips). */
export type VisitorTrip = { city: string; country: string; first_day: string; last_day: string; here: boolean; from: string | null };

/** F-20 own trip (GET /trips). */
export type Trip = {
  id: string;
  city: { id: number; name: string; country: string; lat: number; lng: number };
  first_day: string;
  last_day: string;
  show_days: number | null;
  say_from: boolean;
  shown_from: string | null;
  safe_mode_country: boolean;
};
export type TripLimits = { max: number; ahead_days: number; max_days: number; creates_left: number };

/** GET /places (#113, R-04.20). Venues/events at public coordinates; hosted parties at their r8 centroid. */
export type Place = {
  id: string;
  type: 'venue' | 'event' | 'party';
  kind: 'club' | 'bar' | 'sauna' | 'gym' | 'official' | 'hosted';
  name: string;
  lat: number;
  lng: number;
  distance: Distance | null;
  here?: string | null;
  hours?: string | null;
  starts_at?: string;
  ends_at?: string;
  url?: string | null;
  venue_id?: string;
  venue_name?: string;
  seats?: { taken: number; capacity: number };
  source: 'osm' | 'team' | 'member';
};

/** GET /explore/summary (R-04.17, #104). */
export type ExploreSummary = { place: string | null; counts: Record<Mode, number>; now: number; total?: number; visitors?: number };
export type Grid = { items: Card[]; next: string | null; further_from: number | null; reason: string | null; fit_m?: number | null };
export type MapData = { cells: { cell: string; res: number; count: number }[]; pins: Card[]; avatars: Card[] };

export type ProfileView = {
  /** #115: online now (symmetric with the online setting, R-17.5). */
  online?: boolean;
  id: string;
  kind: Kind;
  display_name: string;
  age: number;
  gender: string;
  gender_other: string | null;
  fields: Record<string, unknown>;
  photos: string[];
  verified: boolean;
  verified_since: string | null;
  member_since: string;
  now: NowStatus | null;
  distance: Distance;
  tapped: boolean;
  tapped_me: boolean;
  vouches: number;
  vouched?: boolean;
  can_vouch?: boolean;
  badges: { kind: string; since?: string; years?: number; up_pct?: number; total?: number }[];
  linked_accounts: { platform: string; handle: string; verified?: boolean; url?: string }[];
  self: boolean;
  /** F-21 R-21.9 (#212): ring on the profile photo. */
  moments?: MomentsBadge;
  /** F-20 R-20.7: his shown trip to the viewer's area. */
  trip?: VisitorTrip | null;
};

export type Settings = {
  hide_from_unverified: boolean;
  hide_from_new: boolean;
  hide_from_age_min: number | null;
  hide_from_age_max: number | null;
  show_in_grid: boolean;
  show_in_map: boolean;
  show_in_tonight: boolean;
  show_in_activities: boolean;
  show_in_venues: boolean;
  /** F-20 R-17.14 */
  show_to_remote?: boolean;
  show_distance: 'exact' | 'range' | 'none';
  online_visible: boolean;
  read_receipts: boolean;
  /** F-21 R-21.17 (#212): watch Moments quietly. */
  moments_quiet?: boolean;
  who_can_message: 'verified' | 'tapped' | 'filters';
  explicit_from_strangers: 'blur' | 'allow' | 'block';
  disappearing_default: '24h' | '7d' | 'never';
  push: Record<string, boolean>;
  quiet_hours: null | { from: number; to: number; tz_offset_min: number };
};

export type ProfileOptions = {
  options: Record<string, string[]>;
  defaults: Record<string, { visibility: Visibility; kinds: Kind[] | 'all'; lenses?: Mode[] }>;
  health: string[];
};

export type Tap = { profile: { id: string; display_name: string; age: number; verified: boolean; photo: string | null }; at: string; seen: boolean; mutual: boolean; kind: Kind };
