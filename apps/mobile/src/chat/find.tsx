// F-07 R-07.39 (#121): search inside one chat, on this phone only. Nothing is sent.
import React from 'react';
import { Text, TextStyle } from 'react-native';
import { tx } from '../i18n/app';
import { color, font } from '../theme/tokens';
import type { Msg } from './engine';

export const FIND_MIN = 2;

/** The searchable text of a message: what the bubble shows in the original (built-in quick replies in the app language). */
export function findText(m: Msg): string {
  const p = m.p;
  switch (p.t) {
    case 'text':
      return p.text;
    case 'quick_reply':
      return (p.k !== undefined && tx.chat.quick[p.k]) || p.text;
    case 'album.grant':
      return p.name;
    default:
      return '';
  }
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Case- and accent-insensitive. */
export function findMatches(text: string, q: string): boolean {
  const n = q.trim();
  return n.length >= FIND_MIN && norm(text).includes(norm(n));
}

/** Indexes (into the newest-first list) of the messages that match, newest first. */
export function findHits(list: { m: Msg }[], q: string | null): number[] {
  if (!q || q.trim().length < FIND_MIN) return [];
  const out: number[] = [];
  list.forEach((x, i) => {
    if (findMatches(findText(x.m), q)) out.push(i);
  });
  return out;
}

/** Text with every match marked in sunflower (R-07.39). Same length mapping: NFD-stripping keeps one char per base letter for Latin text; falls back to plain text otherwise. */
export function Marked({ text, q, style, onAccent }: { text: string; q?: string | null; style?: TextStyle; onAccent?: boolean }) {
  const n = q?.trim() ?? '';
  const hay = norm(text);
  if (n.length < FIND_MIN || hay.length !== text.length) return <Text style={style} selectable>{text}</Text>;
  const needle = norm(n);
  const parts: { s: string; hit: boolean }[] = [];
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) break;
    if (j > i) parts.push({ s: text.slice(i, j), hit: false });
    parts.push({ s: text.slice(j, j + needle.length), hit: true });
    i = j + needle.length;
  }
  if (i < text.length) parts.push({ s: text.slice(i), hit: false });
  return (
    <Text style={style} selectable>
      {parts.map((p, k) =>
        p.hit ? (
          <Text key={k} style={{ backgroundColor: onAccent ? color.onAccent : color.personal, color: onAccent ? color.personal : color.onAccent, fontFamily: font.heavy }}>
            {p.s}
          </Text>
        ) : (
          p.s
        ),
      )}
    </Text>
  );
}
