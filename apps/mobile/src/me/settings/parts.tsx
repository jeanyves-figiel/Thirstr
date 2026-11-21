import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../../api/client';
import type { Settings } from '../../api/types';
import { useSession } from '../../app/session';
import { tx } from '../../i18n/app';
import { color, font, radius, space, touch, type } from '../../theme/tokens';
import { ErrorText, Icon, Loading } from '../../ui';

// Shared building blocks for Settings v3 (#102, S-61, S-64, S-67–S-70).

/** Server settings (R-17.1) with optimistic PATCH and rollback. */
export function useSettings() {
  const { me } = useSession();
  const [st, setSt] = useState<Settings | null>(me.settings ?? null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Settings>('GET', '/me/settings').then(setSt).catch(() => {});
  }, []);
  const put = async (patch: Partial<Settings>) => {
    if (!st) return;
    setErr(null);
    const prev = st;
    setSt({ ...st, ...patch });
    try {
      setSt(await api<Settings>('PATCH', '/me/settings', patch));
    } catch (e) {
      setSt(prev);
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    }
  };
  return { st, put, err, setErr };
}

export function Page({ title, children, err, loading }: { title: string; children?: React.ReactNode; err?: string | null; loading?: boolean }) {
  if (loading) return <Loading />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.xxl, paddingBottom: 120, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 36, color: color.fgPrimary }}>
        {title}
      </Text>
      <ErrorText text={err ?? null} />
      {children}
    </ScrollView>
  );
}

export function Group({ label, children, hint, tone }: { label?: string; children: React.ReactNode; hint?: string; tone?: string }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: space.s }}>
      {label ? <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: tone ?? color.fgMuted, marginHorizontal: space.xs }}>{label}</Text> : null}
      <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden' }}>
        {kids.map((c, i) => (
          <View key={i} style={i ? { borderTopWidth: 1, borderTopColor: color.lineSubtle } : null}>
            {c}
          </View>
        ))}
      </View>
      {hint ? <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{hint}</Text> : null}
    </View>
  );
}

const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.m, minHeight: 56, paddingHorizontal: space.l, paddingVertical: space.s };

export function Row({ title, sub, value, onPress, danger, testID, left, chevron = true, valueTone }: { title: string; sub?: string; value?: string; onPress?: () => void; danger?: boolean; testID?: string; left?: React.ReactNode; chevron?: boolean; valueTone?: string }) {
  const body = (
    <>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontFamily: font.medium, fontSize: 16, color: danger ? color.danger : color.fgPrimary }}>{title}</Text>
        {sub ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text> : null}
      </View>
      {value ? <Text style={{ ...type.meta, fontSize: 14, color: valueTone ?? color.fgSecondary, fontFamily: valueTone ? font.bold : font.medium }}>{value}</Text> : null}
      {onPress && chevron ? <Icon.Next c={danger ? color.danger : color.fgMuted} /> : null}
    </>
  );
  if (!onPress)
    return (
      <View testID={testID} style={rowStyle}>
        {body}
      </View>
    );
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [rowStyle, pressed && { backgroundColor: color.bgOverlay }]}>
      {body}
    </Pressable>
  );
}

export function Switch({ value, onChange, label, tone = color.trust, disabled, testID }: { value: boolean; onChange: (v: boolean) => void; label: string; tone?: string; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={6}
      style={{ width: 51, height: 31, borderRadius: 16, padding: 3, backgroundColor: value ? tone : color.line, opacity: disabled ? 0.45 : 1, alignItems: value ? 'flex-end' : 'flex-start' }}
    >
      <View style={{ width: 25, height: 25, borderRadius: 13, backgroundColor: color.bgInverse }} />
    </Pressable>
  );
}

export function SwitchRow({ title, sub, value, onChange, tone, disabled, testID }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void; tone?: string; disabled?: boolean; testID?: string }) {
  return (
    <View style={rowStyle}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontFamily: font.medium, fontSize: 16, color: color.fgPrimary }}>{title}</Text>
        {sub ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text> : null}
      </View>
      <Switch testID={testID} label={title} value={value} onChange={onChange} tone={tone} disabled={disabled} />
    </View>
  );
}

/** Full-width segmented choice inside a group, with a title and optional caption. */
export function SegBlock<T extends string>({ title, value, options, onChange, tone = color.trust, caption, testID }: { title: string; value: T; options: [T, string][]; onChange: (v: T) => void; tone?: string; caption?: string; testID?: string }) {
  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l, gap: space.s }}>
      <Text style={{ ...type.body, fontFamily: font.medium, fontSize: 16, color: color.fgPrimary }}>{title}</Text>
      <Seg testID={testID} label={title} value={value} options={options} onChange={onChange} tone={tone} />
      {caption ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{caption}</Text> : null}
    </View>
  );
}

export function Seg<T extends string>({ label, value, options, onChange, tone = color.trust, compact, testID }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; tone?: string; compact?: boolean; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', padding: compact ? 3 : 4, gap: 2, borderRadius: radius.pill, backgroundColor: color.bgBase }}>
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <Pressable
            key={k}
            testID={testID ? `${testID}-${k}` : undefined}
            accessibilityRole="radio"
            accessibilityLabel={l}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(k)}
            // #124: full-width segments size to their label (long fr/de words), then share the rest.
            style={{ flexGrow: compact ? 0 : 1, flexShrink: 1, flexBasis: 'auto', minWidth: compact ? 52 : undefined, height: compact ? 34 : 40, paddingHorizontal: compact ? space.m : space.s, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? tone : 'transparent' }}
          >
            <Text numberOfLines={1} style={{ ...type.meta, fontFamily: font.bold, fontSize: 14, color: on ? color.onAccent : color.fgSecondary }}>
              {l}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconTile({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tone }}>{children}</View>;
}

export const minTouch = touch;
