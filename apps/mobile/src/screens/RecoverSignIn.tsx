// F-01 R-01.7 (#25, option B): sign in with the 12 words (S-65), then "You're back" (S-66).
// The words live only in this screen's state; nothing is stored until the server accepts them.
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, Me } from '../api/client';
import * as R from '../auth/recovery';
import * as B from '../chat/backup';
import { bx, mb } from '../i18n/backup';
import { rx } from '../i18n/recovery';
import { Enter, StepShell } from '../onboarding/kit';
import { color, font, radius, space } from '../theme/tokens';
import { ErrorText, Icon } from '../ui';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export function RecoverSignInScreen({ onBack, onDone }: { onBack: () => void; onDone: (me: Me, restored: R.Restored | null) => void }) {
  const [words, setWords] = useState<string[]>(Array(12).fill(''));
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refs = useRef<(React.ComponentRef<typeof TextInput> | null)[]>([]);

  const full = words.every((w) => w.trim());
  const p = R.wordsProblem(words);
  const problem = p === 'checksum' ? rx.checksum : p ? rx.notWord(p.notWord) : null;
  const sugg = R.suggest(words[at] ?? '').filter((w) => w !== words[at]?.trim().toLowerCase());

  const put = (i: number, v: string) => {
    // a pasted phrase in any field fills all 12
    const parts = v.trim().split(/\s+/);
    if (parts.length >= 12) return fill(parts);
    setErr(null);
    setWords((ws) => ws.map((w, j) => (j === i ? v.replace(/\s/g, '').toLowerCase() : w)));
    if (/\s$/.test(v) && i < 11) refs.current[i + 1]?.focus();
  };
  const fill = (parts: string[]) => {
    setErr(null);
    setWords(R.normalize(parts).slice(0, 12).concat(Array(12).fill('')).slice(0, 12));
    refs.current[11]?.blur();
  };
  const pick = (w: string) => {
    setWords((ws) => ws.map((x, j) => (j === at ? w : x)));
    if (at < 11) refs.current[at + 1]?.focus();
  };
  const paste = async () => fill((await Clipboard.getStringAsync()).split(/\s+/));

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await R.signInWithWords(words);
      onDone(r.me, r.restored);
    } catch (e) {
      setErr(e instanceof ApiError && (e.status === 401 || e.status === 404) ? rx.noMatch : e instanceof ApiError ? e.message : rx.noMatch);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell
      title={rx.enterTitle}
      sub={rx.enterSub}
      onBack={onBack}
      scroll
      cta={{ title: rx.signIn, onPress: go, busy, disabled: !full || !!problem, fill: color.trust, testID: 'recover-signin' }}
    >
      <View style={s.grid}>
        {[0, 1, 2, 3, 4, 5].map((r) => (
          <View key={r} style={s.row}>
            {[r, r + 6].map((i) => {
              const bad = !!words[i].trim() && !R.isWord(words[i]) && at !== i;
              return (
                <Pressable key={i} onPress={() => refs.current[i]?.focus()} style={[s.cell, at === i && s.cellOn, bad && s.cellBad]}>
                  <Text style={s.num}>{i + 1}</Text>
                  <TextInput
                    ref={(x) => {
                      refs.current[i] = x;
                    }}
                    testID={`recover-word-${i + 1}`}
                    accessibilityLabel={`${i + 1}`}
                    value={words[i]}
                    onChangeText={(v) => put(i, v)}
                    onFocus={() => setAt(i)}
                    onSubmitEditing={() => (i < 11 ? refs.current[i + 1]?.focus() : undefined)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    importantForAutofill="no"
                    keyboardType={Platform.OS === 'android' ? 'visible-password' : 'ascii-capable'}
                    returnKeyType={i < 11 ? 'next' : 'done'}
                    blurOnSubmit={i === 11}
                    selectionColor={color.trust}
                    style={s.input}
                  />
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={s.bar}>
        {sugg.length ? (
          sugg.map((w) => (
            <Pressable key={w} testID={`recover-sugg-${w}`} accessibilityRole="button" onPress={() => pick(w)} style={({ pressed }) => [s.sugg, pressed && { opacity: 0.7 }]}>
              <Text style={s.suggText}>{w}</Text>
            </Pressable>
          ))
        ) : (
          <Pressable testID="recover-paste" accessibilityRole="button" onPress={paste} style={({ pressed }) => [s.sugg, s.paste, pressed && { opacity: 0.7 }]}>
            <Icon.Copy size={15} c={color.trust} />
            <Text style={[s.suggText, { color: color.trust, fontFamily: font.bold }]}>{rx.paste}</Text>
          </Pressable>
        )}
      </View>
      <ErrorText text={err ?? problem} />
    </StepShell>
  );
}

export function RecoveredScreen({ me, restored, onDone }: { me: Me; restored: R.Restored | null; onDone: () => void }) {
  const name = me.profile?.display_name;
  // R-01.15: an opt-in chat backup can bring the chats back; Chats runs it once the app is open.
  const [chats, setChats] = useState<B.Info>(null);
  useEffect(() => {
    B.info().then(setChats);
  }, []);
  const cta = chats
    ? { title: bx.restore, onPress: () => B.requestRestore().then(onDone), fill: color.trust, testID: 'recover-restore' }
    : { title: rx.go, onPress: onDone, fill: color.bgInverse, testID: 'recover-go' };
  return (
    <StepShell
      title={name ? rx.backTitleName(name) : rx.backTitle}
      cta={cta}
      below={
        chats ? (
          <Pressable testID="recover-go" accessibilityRole="button" onPress={onDone} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={s.ls}>{rx.go}</Text>
          </Pressable>
        ) : undefined
      }
    >
      <Enter delay={40} style={s.list}>
        <Line ok t={rx.r1} />
        <Line ok={!!restored} t={rx.r2} sub={restored ? rx.r2s(day(restored.backupAt)) : rx.r2none} />
        {chats ? <Line ok t={bx.restoreTitle} sub={`${bx.restoreMeta(day(chats.updated_at), mb(chats.bytes))}. ${bx.restoreLater}`} /> : <Line ok={false} t={rx.r3} sub={rx.r3s} />}
        <Line ok t={rx.r4} />
      </Enter>
    </StepShell>
  );
}

function Line({ ok, t, sub }: { ok: boolean; t: string; sub?: string }) {
  return (
    <View style={s.line}>
      <View style={[s.mark, !ok && s.markOff]}>{ok ? <Icon.Check size={16} c={color.trust} /> : <Icon.Close size={14} c={color.fgMuted} />}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.lt, !ok && { color: color.fgSecondary }]}>{t}</Text>
        {sub ? <Text style={s.ls}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { gap: 7, marginTop: space.m },
  row: { flexDirection: 'row', gap: 7 },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.bgRaised, borderRadius: 12, paddingLeft: 10, height: 46, borderWidth: 1.5, borderColor: 'transparent' },
  cellOn: { borderColor: color.trust },
  cellBad: { borderColor: color.hookup },
  num: { width: 18, textAlign: 'right', fontFamily: mono, fontSize: 11, color: color.fgMuted, fontVariant: ['tabular-nums'] },
  input: { flex: 1, height: '100%', fontFamily: mono, fontWeight: '700', fontSize: 15, color: color.fgPrimary, paddingRight: 8 },
  bar: { flexDirection: 'row', gap: 8, marginTop: space.m, minHeight: 40 },
  sugg: { flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
  paste: { flex: 0, flexDirection: 'row', gap: 6, paddingHorizontal: 16, backgroundColor: color.trustTint },
  suggText: { fontFamily: mono, fontWeight: '700', fontSize: 14, color: color.fgPrimary },
  list: { gap: 16, marginTop: space.l },
  line: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  mark: { width: 30, height: 30, borderRadius: 15, backgroundColor: color.trustTint, alignItems: 'center', justifyContent: 'center' },
  markOff: { backgroundColor: color.bgRaised },
  lt: { fontFamily: font.bold, fontSize: 15, color: color.fgPrimary, paddingTop: 5 },
  ls: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.fgSecondary },
});
