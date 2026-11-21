import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type { Mode } from '../api/types';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { color, font, radius, space, type } from '../theme/tokens';
import { Button, ErrorText, Field, Photo, Sheet, VerifiedTick, useAccent } from '../ui';
import { FormLabel, IconChoice, TimeRange, haptic, type IconOption } from '../ui/form';
import { Icon } from '../ui/icons';
import { hhmm, planDefault, planLimits, type Win } from './timeWindow';

type Tag = 'hosting' | 'can_travel' | 'drinks_first' | 'party' | 'other';
type Aud = 'verified' | 'chats';

export const PLAN_TAGS: IconOption<Tag>[] = [
  { value: 'hosting', label: tx.tonight.tags.hosting, icon: (c) => <Icon.Home c={c} /> },
  { value: 'can_travel', label: tx.tonight.tags.can_travel, icon: (c) => <Icon.Car c={c} /> },
  { value: 'drinks_first', label: tx.tonight.tags.drinks_first, icon: (c) => <Icon.Drink c={c} /> },
  { value: 'party', label: tx.tonight.tags.party, icon: (c) => <Icon.Party c={c} /> },
  { value: 'other', label: tx.tonight.tags.other, icon: (c) => <Icon.More c={c} /> },
];
const AUDS: IconOption<Aud>[] = [
  { value: 'verified', label: tx.tonight.audiences.verified, icon: (c) => <Icon.Shield size={18} c={c} /> },
  { value: 'chats', label: tx.tonight.audiences.chats, icon: (c) => <Icon.Chat size={18} c={c} /> },
];

// Last used type is the default next time (#189 smart defaults).
let lastTag: Tag = 'hosting';

// R-09.9 Post plan (#189): type, optional line, one timeline for the window, audience, live preview.
export function PlanSheet({ visible, onClose, onDone, mode }: { visible: boolean; onClose: () => void; onDone: () => void; mode: Mode }) {
  // The form mounts on each open (Modal renders nothing while hidden): fresh "now" and defaults every time.
  return (
    <Sheet visible={visible} onClose={onClose} title={tx.tonight.post} closeLabel={tx.common.close}>
      {visible ? <PlanForm onDone={onDone} mode={mode} /> : null}
    </Sheet>
  );
}

function PlanForm({ onDone, mode }: { onDone: () => void; mode: Mode }) {
  const accent = useAccent();
  const { me } = useSession();
  const [text, setText] = useState('');
  const [tag, setTag] = useState<Tag>(lastTag);
  const [aud, setAud] = useState<Aud>('verified');
  const [now] = useState(() => Date.now());
  const [win, setWin] = useState<Win>(() => planDefault(Date.now()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const limits = planLimits(now);
  const startLabel = win.s === limits.min ? tx.now.now : hhmm(win.s);
  const winLabel = `${startLabel} – ${hhmm(win.e)}`;
  const tagOpt = PLAN_TAGS.find((t) => t.value === tag) ?? PLAN_TAGS[0];
  const p = me.profile;
  const photo = p?.photos.find((x) => x.slot === 0) ?? p?.photos[0];

  const post = async () => {
    setBusy(true);
    setErr(null);
    try {
      // "Now" means the moment of posting.
      const s = win.s === limits.min ? Date.now() : win.s;
      await api('POST', '/tonight', {
        mode,
        text: text.trim(),
        tag,
        audience: aud,
        window_start: new Date(s).toISOString(),
        window_end: new Date(Math.max(win.e, s + 30 * 60_000)).toISOString(),
        tz_offset_min: -new Date().getTimezoneOffset(),
      });
      lastTag = tag;
      haptic.success();
      setText('');
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Live preview of the plan row others will see (R-09.8). */}
      <View testID="plan-preview" accessibilityLabel={`${tx.tonight.preview}: ${text.trim() || tagOpt.label}, ${winLabel}`} style={{ marginTop: space.s, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.bgRaised, padding: space.m + 2, flexDirection: 'row', gap: space.m }}>
        <View style={{ position: 'absolute', top: -9, left: space.m + 2, backgroundColor: color.bgBase, borderColor: color.line, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
          <Text style={{ ...type.caption, fontSize: 10, color: color.fgMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{tx.tonight.preview}</Text>
        </View>
        <Photo uri={photo?.thumb_url ?? photo?.url} id={p?.id ?? 'me'} label="" style={{ width: 48, height: 48, borderRadius: 16 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }} numberOfLines={1}>
              {p?.display_name ?? ''}
            </Text>
            {me.verified ? <VerifiedTick /> : null}
          </View>
          <Text style={{ ...type.body, fontSize: 14, color: color.fgSecondary }} numberOfLines={3}>
            {text.trim() || tagOpt.label}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pill fill={accent} fg={color.onAccent}>
              {tagOpt.icon(color.onAccent)}
              {tagOpt.label}
            </Pill>
            <Pill>{winLabel}</Pill>
            <Pill fg={color.trust}>{aud === 'verified' ? tx.tonight.audiences.verified : tx.tonight.audiences.chats}</Pill>
          </View>
        </View>
      </View>

      <View>
        <FormLabel label={tx.tonight.what} />
        <IconChoice testID="plan-tag" label={tx.tonight.what} options={PLAN_TAGS} value={tag} onChange={setTag} fill={accent} />
      </View>

      <Field testID="plan-text" label={tx.tonight.planText} placeholder={tx.tonight.textHint} value={text} onChangeText={setText} maxLength={140} multiline hint={`${text.length}/140`} />

      <View>
        <FormLabel label={tx.tonight.when} value={tx.tonight.tonightCaption} />
        <TimeRange
          testID="plan-window"
          limits={limits}
          value={win}
          onChange={setWin}
          accent={accent}
          nowLabel={tx.now.now}
          hint={tx.tonight.rangeHint}
          labels={{ start: tx.tonight.start, end: tx.tonight.end, h: tx.tonight.hUnit, min: tx.tonight.minUnit }}
        />
      </View>

      <View>
        <FormLabel label={tx.tonight.audience} />
        <IconChoice testID="plan-aud" row label={tx.tonight.audience} options={AUDS} value={aud} onChange={setAud} fill={color.trust} />
      </View>

      <ErrorText text={err} />
      <Button testID="plan-post" title={`${tx.tonight.publish} · ${winLabel}`} busy={busy} onPress={post} />
    </>
  );
}

function Pill({ children, fill = color.bgBase, fg = color.fgPrimary }: { children: React.ReactNode; fill?: string; fg?: string }) {
  const kids = React.Children.toArray(children);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: fill }}>
      {kids.map((k, i) =>
        typeof k === 'string' ? (
          <Text key={i} style={{ fontFamily: font.bold, fontSize: 12, color: fg }}>
            {k}
          </Text>
        ) : (
          <View key={i} style={{ transform: [{ scale: 0.6 }], marginHorizontal: -4 }}>
            {k}
          </View>
        ),
      )}
    </View>
  );
}
