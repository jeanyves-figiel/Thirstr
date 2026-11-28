import React, { useEffect, useState } from 'react';
import { mute as muteRefill } from '../refill/refill';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { mod } from '../i18n/mod';
import { tx } from '../i18n/app';
import { feel } from '../ui/haptics';
import { color, radius, space, type } from '../theme/tokens';
import { Banner, Button, Icon, Sheet } from '../ui';
import { toast } from '../ui/Toast';
import { forgetFriend } from '../chat/engine';
import { forgetVc } from '../chat/vcheck';

// S-51 shared safety sheet (#111, F-15 R-15.17–R-15.20): same Hide / Block / Report tiles on the
// profile ⋯, map peek ⋯, grid tile long-press, chat ⋯ and inbox long-press. `lead` rows sit above
// the tiles (Explore: Tap, Message, Open profile), `children` below (screen-specific rows).
export type SafetyTarget = {
  id: string;
  name: string;
  age?: number | null;
  sub?: string;
};

type Props = {
  visible: boolean;
  target: SafetyTarget | null;
  onClose: () => void;
  onReport: (t: SafetyTarget) => void;
  /** After hide/block succeeded (list refresh, leave screen…). Undo of a hide calls onRestored. */
  onGone?: (kind: 'hide' | 'block', t: SafetyTarget) => void;
  onRestored?: (t: SafetyTarget) => void;
  /** Hide is Explore-only (R-04): leave it out where it means nothing, e.g. group chats. */
  noHide?: boolean;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  /** Rendered as-is under the tiles (chat settings: toggles, segmented controls). */
  after?: React.ReactNode;
};

const buzz = () => {
  feel('tap');
};

export function SafetySheet({ visible, target, onClose, onReport, onGone, onRestored, noHide, lead, children, after }: Props) {
  // Confirm / error belong to one open sheet for one person: keyed so a reopen starts clean.
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errFor, setErrFor] = useState<{ id: string; text: string } | null>(null);
  if (!target) return null;
  const t = target;
  const confirm = visible && confirmFor === t.id;
  const err = visible && errFor?.id === t.id ? errFor.text : null;
  const setConfirm = (on: boolean) => setConfirmFor(on ? t.id : null);
  const fail = (e: unknown) => setErrFor({ id: t.id, text: e instanceof ApiError ? e.message : tx.common.error });
  const close = () => {
    setConfirmFor(null);
    setErrFor(null);
    onClose();
  };

  const hide = async () => {
    setBusy(true);
    try {
      await api('POST', `/profiles/${t.id}/hide`);
      // F-25 R-25.3: hidden people are never brought back by Refill.
      await muteRefill(t.id, true).catch(() => {});
      buzz();
      close();
      onGone?.('hide', t);
      toast(mod.hidden(t.name), {
        label: mod.undo,
        on: () =>
          api('DELETE', `/profiles/${t.id}/hide`).then(
            () => {
              muteRefill(t.id, false).catch(() => {});
              onRestored?.(t);
            },
            () => {},
          ),
      });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const block = async () => {
    setBusy(true);
    try {
      await api('POST', `/profiles/${t.id}/block`);
      // #115 R-07.36: blocking drops the friendship on this phone; nothing is sent.
      await forgetFriend(t.id).catch(() => {});
      // #159 R-18.7: open video checks and the badge go too; nothing is sent.
      await forgetVc(t.id).catch(() => {});
      buzz();
      close();
      onGone?.('block', t);
      toast(mod.blocked(t.name));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const title = t.age ? `${t.name}, ${t.age}` : t.name;
  return (
    <Sheet visible={visible} onClose={close} title={confirm ? '' : title} closeLabel={tx.common.close}>
      {confirm ? (
        <View testID="block-confirm-sheet" style={{ gap: space.m }}>
          <Tint icon={Icon.Ban} tint={color.danger} />
          <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>
            {mod.blockTitle(t.name)}
          </Text>
          <View style={{ gap: space.s }}>
            {mod.blockPoints.map((p) => (
              <View
                key={p}
                style={{
                  flexDirection: 'row',
                  gap: space.s,
                  alignItems: 'flex-start',
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: color.danger,
                    marginTop: 8,
                  }}
                />
                <Text style={{ ...type.body, color: color.fgSecondary, flex: 1 }}>{p}</Text>
              </View>
            ))}
          </View>
          {err ? <Banner tone="danger" text={err} /> : null}
          <Button testID="block-confirm" title={mod.block} fill={color.danger} busy={busy} onPress={block} />
          <Button kind="ghost" title={mod.cancel} onPress={() => setConfirm(false)} />
        </View>
      ) : (
        <View style={{ gap: space.m }}>
          {t.sub ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{t.sub}</Text> : null}
          {lead ? (
            <View
              style={{
                backgroundColor: color.bgRaised,
                borderRadius: radius.md,
                overflow: 'hidden',
              }}
            >
              {lead}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {noHide ? null : <SafetyTile testID="safety-hide" icon={Icon.EyeOff} tint={color.fgSecondary} label={mod.hide} sub={mod.hideSub} disabled={busy} onPress={hide} />}
            <SafetyTile testID="safety-block" icon={Icon.Ban} tint={color.danger} label={mod.block} sub={mod.blockSub} disabled={busy} onPress={() => setConfirm(true)} />
            <SafetyTile
              testID="safety-report"
              icon={Icon.Flag}
              tint={color.warn}
              label={mod.report}
              sub={mod.reportSub}
              disabled={busy}
              onPress={() => {
                close();
                onReport(t);
              }}
            />
          </View>
          {err ? <Banner tone="danger" text={err} /> : null}
          {children ? (
            <View
              style={{
                backgroundColor: color.bgRaised,
                borderRadius: radius.md,
                overflow: 'hidden',
              }}
            >
              {children}
            </View>
          ) : null}
          {after}
          <Text style={{ ...type.meta, color: color.fgMuted, textAlign: 'center' }}>
            {mod.never(t.name)} <Text style={{ color: color.trust }}>{mod.manage}</Text>
          </Text>
        </View>
      )}
    </Sheet>
  );
}

function Tint({ icon: I, tint }: { icon: (p: { size?: number; c?: string }) => React.ReactElement; tint: string }) {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: `${tint}2E`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <I size={20} c={tint} />
    </View>
  );
}

function SafetyTile({
  icon,
  tint,
  label,
  sub,
  onPress,
  disabled,
  testID,
}: {
  icon: (p: { size?: number; c?: string }) => React.ReactElement;
  tint: string;
  label: string;
  sub: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sub}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 7,
        paddingTop: space.l,
        paddingBottom: space.m,
        paddingHorizontal: space.s,
        borderRadius: radius.md - 2,
        backgroundColor: color.bgRaised,
        opacity: pressed ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Tint icon={icon} tint={tint} />
      <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{label}</Text>
      <Text
        style={{
          ...type.caption,
          fontFamily: type.meta.fontFamily,
          color: color.fgSecondary,
          textAlign: 'center',
        }}
        numberOfLines={2}
      >
        {sub}
      </Text>
    </Pressable>
  );
}

/** Plain row for `lead` / `children` blocks. */
export function SheetRow({ title, onPress, danger, testID, last }: { title: string; onPress: () => void; danger?: boolean; testID?: string; last?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 50,
        paddingHorizontal: space.l,
        justifyContent: 'center',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: color.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          ...type.headline,
          fontSize: 15,
          color: danger ? color.danger : color.fgPrimary,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
