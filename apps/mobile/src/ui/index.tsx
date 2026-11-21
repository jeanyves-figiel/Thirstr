import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDragClose } from './dragClose';
import { color, font, Mode, modeColor, radius, space, tileFor, touch, type } from '../theme/tokens';
import { Icon } from './icons';
export { Icon } from './icons';

// Current mode recolours accent surfaces (R-04.1, design-system.md › Pop).
export const ModeContext = createContext<Mode>('hookup');
/** True inside a Section card: chips and fields switch to a lighter fill so they stay visible (issue 63). */
const CardContext = createContext(false);
export const useAccent = () => modeColor[useContext(ModeContext)];

export function Screen({ children, progress, padded = true }: { children: React.ReactNode; progress?: number; padded?: boolean }) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={[s.content, !padded && { padding: 0 }]} keyboardShouldPersistTaps="handled">
      {progress ? <Progress step={progress} /> : null}
      {children}
    </ScrollView>
  );
}

export function Progress({ step, total = 5 }: { step: number; total?: number }) {
  const accent = useAccent();
  return (
    <View style={s.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[s.seg, i < step && { backgroundColor: accent }]} />
      ))}
    </View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <Text style={s.display} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Title({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <Text style={[s.title, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.body, muted && s.muted, style]}>{children}</Text>;
}

export function Meta({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[s.meta, style]}>{children}</Text>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

type BtnProps = {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'trust';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  small?: boolean;
  fill?: string;
};

export function Button({ title, onPress, kind = 'primary', disabled, busy, testID, small, fill }: BtnProps) {
  const accent = useAccent();
  const off = disabled || busy;
  const bg = fill ?? (kind === 'primary' ? accent : kind === 'trust' ? color.trust : undefined);
  const onFill = !!bg;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, small && s.btnSmall, s[kind === 'trust' ? 'primary' : kind], bg ? { backgroundColor: bg } : null, off && s.off, pressed && !off && s.pressed]}
    >
      {busy ? (
        <ActivityIndicator color={onFill ? color.onAccent : color.fgPrimary} />
      ) : (
        <Text style={[s.btnText, small && s.btnTextSmall, onFill && s.btnTextOnFill, kind === 'danger' && s.btnTextDanger]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Chip({ label, on, onPress, disabled, fill }: { label: string; on: boolean; onPress: () => void; disabled?: boolean; fill?: string }) {
  const ctx = useAccent();
  const inCard = useContext(CardContext);
  const accent = fill ?? ctx;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled }}
      onPress={disabled ? undefined : onPress}
      style={[s.chip, inCard && { backgroundColor: color.line }, on && { backgroundColor: accent, borderColor: accent }, disabled && s.off]}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: React.ReactNode }) {
  return <View style={s.chips}>{children}</View>;
}

/** Segmented pill (Map/Grid, mode switch). `fills` gives each selected segment its own colour. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  fills,
  label,
  grow,
}: {
  value: T;
  /** badge: small coral count after the label (#211 Unread); hidden at 0. */
  options: { value: T; label: string; badge?: number }[];
  onChange: (v: T) => void;
  fills?: Partial<Record<T, string>>;
  label: string;
  grow?: boolean;
}) {
  const inCard = useContext(CardContext);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[s.segmented, inCard && { backgroundColor: color.bgOverlay }, grow && { flex: 1 }]}>
      {options.map((o) => {
        const on = o.value === value;
        const bg = on ? (fills?.[o.value] ?? color.bgInverse) : 'transparent';
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.badge ? `${o.label}, ${o.badge}` : o.label}
            onPress={() => onChange(o.value)}
            // #124: grown tabs size to their label (long fr/de words) and share the rest, instead of equal slots.
            style={[s.segBtn, grow && { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: space.s }, { backgroundColor: bg }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[s.segText, on && { color: color.onAccent }, { flexShrink: 1 }]}>
                {o.label}
              </Text>
              {o.badge ? (
                <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...type.caption, color: color.onAccent }}>{o.badge > 99 ? '99+' : o.badge}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field(props: TextInputProps & { label: string; error?: string; hint?: string; bare?: boolean }) {
  const { label, error, hint, onFocus, onBlur, bare, ...rest } = props;
  const accent = useAccent();
  const inCard = useContext(CardContext);
  const [focus, setFocus] = React.useState(false);
  return (
    <View style={s.field}>
      {bare ? null : <Text style={s.sectionTitle}>{label}</Text>}
      <TextInput
        placeholderTextColor={color.fgMuted}
        style={[s.input, inCard && { backgroundColor: color.bgOverlay, borderColor: color.bgOverlay }, rest.multiline && s.inputMulti, focus && { borderColor: accent }, error ? s.inputErr : null, WEB_NO_OUTLINE]}
        accessibilityLabel={label}
        onFocus={(e) => {
          setFocus(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {error ? <Text style={s.err}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Check({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const accent = useAccent();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={s.checkRow}>
      <View style={[s.box, on && { backgroundColor: accent, borderColor: accent }]}>{on ? <Text style={s.tick}>✓</Text> : null}</View>
      <Text style={[s.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ label, sub, value, onChange, disabled, tone }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; tone?: string }) {
  return (
    <View style={[s.row, disabled && s.off]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle}>{label}</Text>
        {sub ? <Text style={s.meta}>{sub}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: tone ?? color.trust, false: color.line }}
        thumbColor={color.bgInverse}
        {...(Platform.OS === 'web' ? { activeThumbColor: color.bgInverse } : {})}
      />
    </View>
  );
}

export function ListRow({ title, sub, onPress, right, danger, testID }: { title: string; sub?: string; onPress?: () => void; right?: string; danger?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [s.row, pressed && s.pressed]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.rowTitle, danger && { color: color.danger }]}>{title}</Text>
        {sub ? <Text style={s.hint}>{sub}</Text> : null}
      </View>
      {right ? <Text style={s.rowValue}>{right}</Text> : null}
      {onPress && !danger ? <Icon.Next /> : null}
    </Pressable>
  );
}

/** Read-only tag (profile details, issue 71): not pressable, neutral unless a tone is given. */
export function Tag({ label, tone }: { label: string; tone?: string }) {
  const inCard = useContext(CardContext);
  return (
    <View style={{ height: 32, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: tone ? `${tone}26` : inCard ? color.bgOverlay : color.bgRaised }}>
      <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 14, color: tone ?? color.fgPrimary }}>{label}</Text>
    </View>
  );
}

/** App v2 uppercase group label (issue 63). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.sectionTitle}>{children}</Text>;
}

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
      <View style={s.card}>
        <CardContext.Provider value>
        {React.Children.toArray(children)
          .filter(Boolean)
          .map((c, i) => (
            <View key={i} style={i ? s.sep : null}>
              {c}
            </View>
          ))}
        </CardContext.Provider>
      </View>
    </View>
  );
}

export function Banner({ text, tone = 'trust', onPress, testID }: { text: string; tone?: 'trust' | 'danger' | 'warn' | 'personal'; onPress?: () => void; testID?: string }) {
  const c = tone === 'warn' ? color.personal : color[tone];
  return (
    <Pressable testID={testID} onPress={onPress} style={[s.banner, { backgroundColor: `${c}1A` }]} accessibilityRole={onPress ? 'button' : 'alert'}>
      <Text style={[s.meta, { color: c, flex: 1, fontFamily: font.bold, fontSize: 14, lineHeight: 20 }]}>{text}</Text>
      {onPress ? <Icon.Next c={c} /> : null}
    </Pressable>
  );
}

export function Badge({ label, fill, small }: { label: string; fill: string; small?: boolean }) {
  return (
    <View style={[s.badge, { backgroundColor: fill }, small && { paddingHorizontal: space.s, paddingVertical: 2 }]} accessibilityLabel={label}>
      <Text style={s.badgeText}>{label}</Text>
    </View>
  );
}

export function VerifiedTick({ size = 14 }: { size?: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Verified" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center' }}>
      <Icon.Check size={size * 0.62} w={3.6} />
    </View>
  );
}

export function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <Text style={s.err} accessibilityRole="alert">
      {text}
    </Text>
  ) : null;
}

export function EmptyState({ title, body, action, onAction }: { title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.empty}>
      <Text style={[s.title, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[s.body, s.muted, { textAlign: 'center' }]}>{body}</Text> : null}
      {action && onAction ? <Button title={action} onPress={onAction} /> : null}
    </View>
  );
}

export function ErrorState({ text, onRetry, retry }: { text: string; onRetry: () => void; retry: string }) {
  return (
    <View style={s.empty}>
      <Text style={[s.body, s.muted, { textAlign: 'center' }]}>{text}</Text>
      <Button title={retry} kind="secondary" onPress={onRetry} />
    </View>
  );
}

export function Loading() {
  const accent = useAccent();
  return <ActivityIndicator style={{ flex: 1, padding: space.xxl }} color={accent} />;
}

/** Photo with placeholder tone (tile.*) until loaded or when there is none. */
export function Photo({ uri, id, style, label }: { uri: string | null | undefined; id: string; style: ViewStyle; label: string }) {
  return (
    <View style={[{ backgroundColor: tileFor(id), overflow: 'hidden' }, style]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} accessibilityLabel={label} resizeMode="cover" /> : null}
    </View>
  );
}

/** Bottom scrim over photos (App v2): stepped ink bands, transparent → ~90 %, no gradient dependency. */
export function Scrim({ height = '60%', max = 0.9, steps = 10 }: { height?: ViewStyle['height']; max?: number; steps?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }}>
      {Array.from({ length: steps }, (_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: color.bgBase, opacity: (max * (i + 1)) / steps }} />
      ))}
    </View>
  );
}

/** Bottom sheet (S-12, S-30, …). */
// #124: iOS can't show the system share sheet (or any other native modal) on top of a closing
// RN Modal: after "Cancel" the dead Modal keeps the touches and the screen freezes. Close the
// sheet, then run the action from `afterSheet` once the Modal is gone (onDismiss, or a timeout
// where onDismiss doesn't exist).
/** #134: true while the software keyboard is up. A bar that sits on the keyboard must drop the
 *  home-indicator inset then (the keyboard already covers it), or a gap shows above the keys. */
export function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const a = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const b = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return shown;
}

// #135 R-08.11: the chat media tray takes the keyboard's place, so the nav bar hides for it too.
let panelOpen = false;
const panelSubs = new Set<(v: boolean) => void>();
export function setBottomPanel(v: boolean) {
  panelOpen = v;
  panelSubs.forEach((f) => f(v));
}
export function useBottomPanel() {
  const [v, setV] = useState(panelOpen);
  useEffect(() => {
    panelSubs.add(setV);
    return () => {
      panelSubs.delete(setV);
    };
  }, []);
  return v;
}

/** #137: the Pop nav bar floats on every screen (Main.tsx): 52 pt pill + 6 pt padding ×2 + 8 pt gap. */
export const NAV_BAR = 72;
/** Space a bottom-anchored element must leave for the nav bar (0 while the keyboard is up: the bar hides). */
export function useNavSpace() {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardShown();
  return { kb, bottom: kb ? 0 : insets.bottom + NAV_BAR };
}

let afterDismiss: (() => void) | null = null;
let afterTimer: ReturnType<typeof setTimeout> | null = null;
const flushAfterSheet = () => {
  if (afterTimer) clearTimeout(afterTimer);
  afterTimer = null;
  const fn = afterDismiss;
  afterDismiss = null;
  fn?.();
};
export function afterSheet(fn: () => void) {
  afterDismiss = fn;
  if (afterTimer) clearTimeout(afterTimer);
  afterTimer = setTimeout(flushAfterSheet, Platform.OS === 'ios' ? 900 : 350);
}

export function Sheet({ visible, onClose, title, children, closeLabel = 'Close' }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; closeLabel?: string }) {
  // F-19 G15 (#187): drag the handle or header down to close; ✕ and tapping outside still work.
  const drag = useDragClose(onClose);
  const { reset } = drag;
  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={flushAfterSheet}>
      {/* Android: a Modal is its own window, so gestures need their own root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      {/* #134: the sheet rides up with the keyboard so its fields stay visible. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Animated.View style={[{ flex: 1 }, drag.scrimStyle]}>
        <Pressable style={s.scrim} onPress={onClose} accessibilityLabel={closeLabel} />
      </Animated.View>
      <Animated.View style={[s.sheet, drag.sheetStyle]} onLayout={drag.onLayout} accessibilityViewIsModal onAccessibilityEscape={onClose}>
        <GestureDetector gesture={drag.pan}>
          <View>
            <View style={s.handleRow}>
              <View style={s.handle} />
            </View>
            <View style={s.sheetHead}>
              <Text style={s.title} accessibilityRole="header">
                {title}
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} style={s.close}>
                <Icon.Close />
              </Pressable>
            </View>
          </View>
        </GestureDetector>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.l, paddingBottom: space.huge }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {children}
        </ScrollView>
      </Animated.View>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** App v2 hero card (Party, Venue, Activity, Club; issue 63): colour fill, status pill, big title, meta, stat tiles. */
export function Hero({ fill, pill, title, meta, stats, testID }: { fill: string; pill: string; title: string; meta?: string; stats?: { k: string; v: string }[]; testID?: string }) {
  return (
    <View testID={testID} style={[s.hero, { backgroundColor: fill }]}>
      <View pointerEvents="none" style={s.heroBlobA} />
      <View pointerEvents="none" style={s.heroBlobB} />
      <View style={s.heroPill}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fill }} />
        <Text style={[s.badgeText, { color: fill, letterSpacing: 0.6, textTransform: 'uppercase' }]}>{pill}</Text>
      </View>
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 34, color: color.onAccent }}>
        {title}
      </Text>
      {meta ? <Text style={{ ...type.headline, fontFamily: font.bold, color: color.onAccent, opacity: 0.8 }}>{meta}</Text> : null}
      {stats?.length ? (
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
          {stats.map((x) => (
            <View key={x.k} style={s.heroStat}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ ...type.title, fontSize: 19, lineHeight: 24, color: color.onAccent }}>
                {x.v}
              </Text>
              <Text numberOfLines={1} style={{ ...type.meta, fontFamily: font.bold, fontSize: 12, color: color.onAccent, opacity: 0.75 }}>
                {x.k}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** App v2 two-thumb range slider (issue 71): ages in Filters and Settings › Hide me from. */
export function RangeSlider({ min, max, low, high, onChange, fill, label, format = String }: { min: number; max: number; low: number; high: number; onChange: (low: number, high: number) => void; fill?: string; label: string; format?: (v: number) => string }) {
  const ctx = useAccent();
  const accent = fill ?? ctx;
  const [w, setW] = React.useState(0);
  const T = 30;
  const span = Math.max(1, w - T);
  const toX = (v: number) => ((v - min) / (max - min)) * span;
  const [drag, setDrag] = React.useState<{ i: number; x0: number; v0: number } | null>(null);
  const handlers = (i: number) => ({
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: { nativeEvent: { pageX: number } }) => setDrag({ i, x0: e.nativeEvent.pageX, v0: i === 0 ? low : high }),
    onResponderMove: (e: { nativeEvent: { pageX: number } }) => {
      if (!drag || drag.i !== i) return;
      const v = Math.max(min, Math.min(max, Math.round(drag.v0 + ((e.nativeEvent.pageX - drag.x0) / span) * (max - min))));
      if (i === 0) onChange(Math.min(v, high - 1), high);
      else onChange(low, Math.max(v, low + 1));
    },
    onResponderRelease: () => setDrag(null),
  });
  return (
    <View style={{ gap: space.m }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={s.sectionTitle}>{label}</Text>
        <Text style={{ ...type.title, fontSize: 20, color: color.fgPrimary }}>
          {format(low)} – {format(high)}
        </Text>
      </View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: T, justifyContent: 'center' }} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: `${format(low)} – ${format(high)}` }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: color.line, marginHorizontal: T / 2 }} />
        {w ? (
          <>
            <View style={{ position: 'absolute', height: 6, borderRadius: 3, backgroundColor: accent, left: toX(low) + T / 2, width: Math.max(0, toX(high) - toX(low)) }} />
            {[low, high].map((v, i) => (
              <View key={i} {...handlers(i)} hitSlop={12} style={{ position: 'absolute', left: toX(v), width: T, height: T, borderRadius: T / 2, backgroundColor: color.bgInverse, borderWidth: 3, borderColor: accent }} />
            ))}
          </>
        ) : null}
      </View>
    </View>
  );
}

/** App v2 round back button (stack headers, issue 63). */
export function BackButton({ onPress, label = 'Back' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [s.round, pressed && s.pressed]}>
      <Icon.Back />
    </Pressable>
  );
}

/** App v2 sticky bottom action: one pill over a fade (issue 63). Put it after the ScrollView. */
export function StickyCta({ children }: { children: React.ReactNode }) {
  const nav = useNavSpace();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      <Scrim height={110 + nav.bottom} max={1} steps={8} />
      {/* #137: sits on top of the nav bar. */}
      <View style={{ paddingHorizontal: space.l, paddingBottom: nav.bottom + space.m, paddingTop: space.s, gap: space.s }}>{children}</View>
    </View>
  );
}

export function Wordmark({ size = 27 }: { size?: number }) {
  const dot = size * 0.3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }} accessibilityRole="header" accessibilityLabel="Thirstr">
      <Text style={{ ...type.display, fontSize: size, lineHeight: size * 1.2, letterSpacing: -size * 0.04, color: color.fgPrimary }}>
        thirst<Text style={{ color: color.hookup }}>r</Text>
      </Text>
      {[color.personal, color.friends, color.sport].map((c) => (
        <View key={c} style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: c, marginLeft: size * 0.08 }} />
      ))}
    </View>
  );
}

const WEB_NO_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgBase },
  content: { padding: space.l, paddingTop: space.xxxl + space.xl, gap: space.l, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1, paddingBottom: 120 },
  progress: { flexDirection: 'row', gap: space.xs },
  seg: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: color.line },
  display: { ...type.display, color: color.fgPrimary },
  title: { ...type.title, color: color.fgPrimary },
  headline: { ...type.headline, color: color.fgPrimary },
  body: { ...type.body, color: color.fgPrimary },
  meta: { ...type.meta, color: color.fgSecondary },
  muted: { color: color.fgSecondary },
  label: { ...type.meta, color: color.fgSecondary, marginBottom: space.xs },
  sectionTitle: { ...type.caption, fontSize: 12, lineHeight: 16, color: color.fgMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: space.xs },
  rowTitle: { ...type.headline, fontFamily: font.bold, color: color.fgPrimary },
  rowValue: { ...type.meta, fontFamily: font.bold, fontSize: 14, color: color.fgSecondary },
  sep: { borderTopWidth: 1, borderColor: color.lineSubtle },
  hero: { borderRadius: 28, padding: space.xl, gap: space.s, overflow: 'hidden' },
  heroBlobA: { position: 'absolute', right: -60, top: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: color.bgInverse, opacity: 0.18 },
  heroBlobB: { position: 'absolute', right: 30, bottom: -90, width: 160, height: 160, borderRadius: 80, backgroundColor: color.bgBase, opacity: 0.1 },
  heroPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: color.bgBase },
  heroStat: { flex: 1, paddingVertical: 10, paddingHorizontal: space.m, borderRadius: 18, backgroundColor: 'rgba(23,20,46,0.14)', gap: 2 },
  round: { width: touch, height: touch, borderRadius: touch / 2, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
  hint: { ...type.meta, color: color.fgMuted },
  btn: { minHeight: 56, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  btnSmall: { minHeight: touch, paddingHorizontal: space.l },
  primary: {},
  trust: {},
  secondary: { backgroundColor: color.bgRaised, borderWidth: 1, borderColor: color.line },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.danger },
  off: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  btnText: { ...type.headline, fontSize: 17, color: color.fgPrimary },
  btnTextSmall: { ...type.meta, fontFamily: type.headline.fontFamily },
  btnTextOnFill: { color: color.onAccent },
  btnTextDanger: { color: color.danger },
  chip: { minHeight: 40, paddingHorizontal: space.l, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: color.bgRaised },
  chipText: { ...type.meta, fontFamily: font.bold, fontSize: 15, color: color.fgPrimary },
  chipTextOn: { color: color.onAccent, fontFamily: type.headline.fontFamily },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  segmented: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: radius.pill, backgroundColor: color.bgRaised },
  segBtn: { minHeight: 38, paddingHorizontal: space.m, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segText: { ...type.meta, fontFamily: type.headline.fontFamily, color: color.fgPrimary },
  field: { gap: space.s },
  input: { ...type.body, fontSize: 17, minHeight: 56, color: color.fgPrimary, backgroundColor: color.bgRaised, borderRadius: 18, borderWidth: 2, borderColor: color.bgRaised, paddingHorizontal: space.l },
  inputMulti: { minHeight: 112, paddingTop: 14, paddingBottom: 14, lineHeight: 22, textAlignVertical: 'top' },
  inputErr: { borderColor: color.danger },
  err: { ...type.meta, color: color.danger },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: touch },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: color.fgSecondary, alignItems: 'center', justifyContent: 'center' },
  tick: { color: color.onAccent, fontFamily: type.headline.fontFamily },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingVertical: space.m },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.s, borderRadius: 20, paddingVertical: 14, paddingHorizontal: space.l },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs, alignSelf: 'flex-start' },
  badgeText: { ...type.caption, color: color.onAccent },
  card: { backgroundColor: color.bgRaised, borderRadius: radius.md, overflow: 'hidden', paddingHorizontal: space.l, paddingVertical: space.xs },
  spacer: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.l, padding: space.xxl, flexGrow: 1 },
  scrim: { flex: 1, backgroundColor: color.scrim },
  sheet: { maxHeight: '88%', backgroundColor: color.bgBase, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.l },
  handleRow: { height: space.l + 6, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: radius.pill, backgroundColor: color.line },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.m },
  close: { marginLeft: 'auto', width: touch, height: touch, borderRadius: touch / 2, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
});
