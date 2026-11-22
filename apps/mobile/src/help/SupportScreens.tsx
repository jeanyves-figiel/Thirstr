import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import app from '../../app.json';
import { api, ApiError, putBlob } from '../api/client';
import { buildNumber } from '../app/config';
import { hx } from '../i18n/help';
import { color, font, radius, space, type } from '../theme/tokens';
import { Loading } from '../ui';
import { ArticleRow, Cap, Card, lang, metaOf } from './kit';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void; replace?: (s: string, p?: object) => void };
type R<P> = { navigation: Nav; route: { params?: P } };

const TOPICS = ['account', 'safety', 'broken', 'privacy', 'other'] as const;
type Topic = (typeof TOPICS)[number];
/** R-22.8: per topic, the answers that solve most requests before the form. */
const SUGGEST: Record<Topic, string[]> = {
  account: ['lost-phone', 'new-phone', 'recovery-words'],
  safety: ['report-someone', 'block-hide', 'date-checkin'],
  broken: ['data-saver', 'selfie-fails'],
  privacy: ['download-data', 'pause-delete', 'who-sees-location'],
  other: ['how-thirstr-works', 'free'],
};
const MIN = 20;

const scroll = { style: { flex: 1, backgroundColor: color.bgBase }, contentContainerStyle: { padding: space.l, paddingTop: space.s, gap: space.xl, paddingBottom: 140, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const } };
const input = { ...type.body, fontSize: 16, color: color.fgPrimary, padding: space.m, borderRadius: radius.sm, backgroundColor: color.bgRaised, textAlignVertical: 'top' as const };

const Title = ({ children }: { children: string }) => (
  <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 36, color: color.fgPrimary }}>
    {children}
  </Text>
);

export function Pill({ label, on, onPress, tone = color.bgInverse, testID }: { label: string; on: boolean; onPress: () => void; tone?: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ paddingHorizontal: space.l, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? tone : color.bgRaised }}>
      <Text style={{ ...type.meta, fontFamily: font.bold, color: on ? color.onAccent : color.fgPrimary }}>{label}</Text>
    </Pressable>
  );
}

export function Cta({ title, onPress, disabled, busy, tone = color.hookup, testID, kind = 'fill' }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; tone?: string; testID?: string; kind?: 'fill' | 'ghost' }) {
  const off = disabled || busy;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={onPress} style={({ pressed }) => ({ height: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === 'fill' ? tone : 'transparent', borderWidth: kind === 'ghost' ? 1 : 0, borderColor: color.line, opacity: off ? 0.45 : pressed ? 0.85 : 1 })}>
      <Text style={{ ...type.headline, color: kind === 'fill' ? color.onAccent : color.fgPrimary }}>{busy ? hx.sending : title}</Text>
    </Pressable>
  );
}

function Check({ on, title, sub, onPress, testID }: { on: boolean; title: string; sub?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingHorizontal: space.l, paddingVertical: space.s }}>
      <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? color.trust : color.fgMuted, backgroundColor: on ? color.trust : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Text style={{ color: color.onAccent, fontFamily: font.heavy, fontSize: 14 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.body, fontFamily: font.medium, color: color.fgPrimary }}>{title}</Text>
        {sub ? <Text style={{ ...type.meta, color: color.fgMuted }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function details() {
  const b = buildNumber();
  return { version: app.expo.version, build: b ?? undefined, platform: Platform.OS, os: String(Platform.Version), lang };
}

/** ≤ 1600 px JPEG, metadata stripped by re-encoding (R-22.10), then a presigned PUT. */
async function uploadShot(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1200 });
  const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  const size = (await (await fetch(out.uri)).blob()).size;
  const up = await api<{ id: string; upload_url: string }>('POST', '/support/uploads', { size });
  await putBlob(up.upload_url, out.uri, 'image/jpeg');
  return up.id;
}

/**
 * S-82 Contact (R-22.7–R-22.10). Signed in: answer in the app, email copy optional.
 * Signed out (`signedOut`): email is the only channel. Never a social-engineering path: the form can't change an account.
 */
export function ContactForm({ signedOut, onDone, onArticle, onGo, initialTopic }: { signedOut?: boolean; onDone: (ref: string, topic: Topic) => void; onArticle?: (id: string) => void; onGo?: (route: string) => void; initialTopic?: Topic }) {
  const [topic, setTopic] = useState<Topic | null>(initialTopic ?? null);
  const [still, setStill] = useState(!!initialTopic);
  const [msg, setMsg] = useState('');
  const [shots, setShots] = useState<string[]>([]);
  const [withDetails, setWithDetails] = useState(true);
  const [mail, setMail] = useState(!!signedOut);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
    if (!r.canceled && r.assets[0]) setShots((s) => [...s, r.assets[0].uri].slice(0, 2));
  };

  const left = MIN - msg.trim().length;
  const emailOk = !mail || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const send = async () => {
    if (!topic) return;
    setBusy(true);
    setErr(null);
    try {
      const attachments = await Promise.all(shots.map(uploadShot));
      const r = await api<{ ref: string }>('POST', '/support/requests', { topic, lang, message: msg.trim(), attachments, app_details: withDetails ? details() : undefined, reply_email: mail ? email.trim() : undefined });
      onDone(r.ref, topic);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : hx.send);
    } finally {
      setBusy(false);
    }
  };

  const suggest = topic ? SUGGEST[topic] : [];
  return (
    <>
      <View style={{ gap: space.s }}>
        <Cap>{hx.about}</Cap>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {TOPICS.map((t) => (
            <Pill key={t} testID={`contact-topic-${t}`} label={hx.topicsC[t]} on={topic === t} onPress={() => (setTopic(t), setStill(false))} />
          ))}
        </View>
      </View>

      {topic === 'safety' ? (
        <View style={{ gap: space.m, padding: space.l, borderRadius: radius.md, backgroundColor: color.alertBg }}>
          <Text style={{ ...type.body, color: color.alertBody }}>{hx.safetyFirst}</Text>
          {onArticle ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              <Pill label={hx.report} on onPress={() => onArticle('report-someone')} tone={color.hookup} />
              <Pill label={hx.sos} on={false} onPress={() => onArticle('date-checkin')} />
            </View>
          ) : null}
        </View>
      ) : null}
      {topic === 'privacy' && onGo ? (
        <Card>
          <ArticleRowLink title={hx.download} onPress={() => onGo('AccountSettings')} />
          <ArticleRowLink title={hx.deleteAcc} onPress={() => onGo('AccountSettings')} />
        </Card>
      ) : null}
      {topic === 'privacy' ? <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{hx.dpo}</Text> : null}

      {topic && !still && onArticle ? (
        <View style={{ gap: space.s }}>
          <Cap>{hx.usually}</Cap>
          <Card>
            {suggest.map((id) => {
              const m = metaOf(id);
              return m ? <ArticleRow key={id} m={m} onPress={() => onArticle(id)} /> : null;
            })}
          </Card>
          <Cta testID="contact-still" kind="ghost" title={hx.still} onPress={() => setStill(true)} />
        </View>
      ) : null}

      {topic && (still || !onArticle) ? (
        <>
          <View style={{ gap: space.s }}>
            <Cap>{hx.more}</Cap>
            <TextInput testID="contact-msg" value={msg} onChangeText={setMsg} maxLength={4000} multiline placeholder={hx.msgPh} placeholderTextColor={color.fgMuted} style={{ ...input, minHeight: 140 }} />
            <Text style={{ ...type.meta, color: left > 0 ? color.fgMuted : color.trust, marginHorizontal: space.xs }}>{left > 0 ? hx.tooShort(left) : `${msg.trim().length} / 4000`}</Text>
          </View>
          {Platform.OS !== 'web' ? (
            <View style={{ gap: space.s }}>
              <View style={{ flexDirection: 'row', gap: space.s }}>
                {shots.map((u, i) => (
                  <Pressable key={u} accessibilityLabel={hx.removeShot} onPress={() => setShots((s) => s.filter((_, j) => j !== i))}>
                    <Image source={{ uri: u }} style={{ width: 72, height: 120, borderRadius: radius.sm }} />
                    <Text style={{ position: 'absolute', top: 4, right: 6, color: color.fgPrimary, fontFamily: font.heavy }}>✕</Text>
                  </Pressable>
                ))}
                {shots.length < 2 ? (
                  <Pressable testID="contact-shot" accessibilityRole="button" accessibilityLabel={hx.addShot} onPress={pick} style={{ width: 72, height: 120, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: color.line, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 26, color: color.fgMuted }}>+</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{hx.shotsNote}</Text>
            </View>
          ) : null}
          <Card>
            <Check testID="contact-details" on={withDetails} title={hx.details} sub={hx.detailsList(`${app.expo.version} · ${Platform.OS} ${Platform.Version} · ${lang}`)} onPress={() => setWithDetails(!withDetails)} />
          </Card>
          <View style={{ gap: space.s }}>
            <Cap>{hx.how}</Cap>
            <Card>
              {!signedOut ? <Check on title={hx.inApp} sub={hx.inAppSub} onPress={() => {}} /> : null}
              {!signedOut ? <Check testID="contact-mail" on={mail} title={hx.alsoEmail} sub={hx.alsoEmailSub} onPress={() => setMail(!mail)} /> : null}
              {mail ? (
                <View style={{ padding: space.l, gap: space.s }}>
                  <TextInput testID="contact-email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={hx.emailPh} placeholderTextColor={color.fgMuted} style={{ ...input, backgroundColor: color.bgOverlay }} />
                  {signedOut ? <Text style={{ ...type.meta, color: color.fgMuted }}>{hx.emailNeeded}</Text> : null}
                </View>
              ) : null}
            </Card>
          </View>
          {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
          <Cta testID="contact-send" title={hx.send} busy={busy} disabled={left > 0 || !emailOk || (mail && !email.trim())} onPress={send} />
          <Text style={{ ...type.meta, color: color.trust, textAlign: 'center' }}>🔒 {hx.never}</Text>
        </>
      ) : null}
    </>
  );
}

function ArticleRowLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.l }}>
      <Text style={{ flex: 1, ...type.body, fontFamily: font.medium, color: color.fgPrimary }}>{title}</Text>
      <Text style={{ ...type.headline, color: color.fgMuted }}>›</Text>
    </Pressable>
  );
}

/** S-82s sent: reference, when to expect an answer, the "we'll never ask" warning (R-22.11). */
export function ContactSent({ refCode, topic, email, onDone, onRequests }: { refCode: string; topic: string; email?: boolean; onDone: () => void; onRequests?: () => void }) {
  return (
    <View style={{ gap: space.xl, paddingTop: space.xxl }}>
      <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
        <Text style={{ fontSize: 36, color: color.onAccent, fontFamily: font.heavy }}>✓</Text>
      </View>
      <Text style={{ ...type.display, textAlign: 'center', color: color.fgPrimary }}>{hx.gotIt}</Text>
      <Text testID="contact-ref" style={{ ...type.title, textAlign: 'center', color: color.trust, letterSpacing: 2 }}>
        {refCode}
      </Text>
      <Text style={{ ...type.body, textAlign: 'center', color: color.fgSecondary }}>{email ? hx.replyMail : topic === 'safety' ? hx.reply24 : hx.reply2d}</Text>
      <View style={{ padding: space.l, gap: space.xs, borderRadius: radius.md, backgroundColor: color.trustTint }}>
        <Text style={{ ...type.headline, color: color.trust }}>🔒 {hx.neverTitle}</Text>
        <Text style={{ ...type.body, color: color.fgSoft }}>{hx.neverBody}</Text>
      </View>
      {onRequests ? <Cta tone={color.trust} title={hx.seeRequests} onPress={onRequests} /> : null}
      <Cta kind="ghost" title={hx.done} onPress={onDone} />
    </View>
  );
}

export function HelpContactScreen({ navigation, route }: R<{ topic?: Topic }>) {
  const [sent, setSent] = useState<{ ref: string; topic: string } | null>(null);
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets {...scroll}>
      {sent ? (
        <ContactSent refCode={sent.ref} topic={sent.topic} onDone={() => navigation.goBack()} onRequests={() => (navigation.replace ?? navigation.navigate)('HelpRequests')} />
      ) : (
        <>
          <Title>{hx.contact}</Title>
          <ContactForm initialTopic={route.params?.topic} onDone={(ref, topic) => setSent({ ref, topic })} onArticle={(id) => navigation.navigate('HelpArticle', { id })} onGo={(r) => navigation.navigate(r)} />
        </>
      )}
    </ScrollView>
  );
}

type Req = { id: string; ref: string; topic: string; status: string; updated_at: string; unread: boolean; last: string };
const stTone: Record<string, string> = { open: color.fgMuted, waiting: color.personal, solved: color.trust };

/** S-85 Your requests. */
export function HelpRequestsScreen({ navigation }: R<undefined>) {
  const [list, setList] = useState<Req[] | null>(null);
  const load = useCallback(() => api<{ requests: Req[] }>('GET', '/support/requests').then((r) => setList(r.requests), () => setList([])), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!list) return <Loading />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
      <Title>{hx.requests}</Title>
      {list.length ? (
        <Card>
          {list.map((r) => (
            <Pressable key={r.id} testID={`req-${r.ref}`} accessibilityRole="button" onPress={() => navigation.navigate('HelpThread', { id: r.id })} style={{ padding: space.l, gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                {r.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.hookup }} /> : null}
                <Text style={{ flex: 1, ...type.headline, color: color.fgPrimary }}>
                  {hx.topicsC[r.topic] ?? r.topic} <Text style={{ color: color.fgMuted, fontFamily: font.medium }}>· {r.ref}</Text>
                </Text>
                <Text style={{ ...type.caption, color: stTone[r.status] ?? color.fgMuted }}>{hx.status[r.status] ?? r.status}</Text>
              </View>
              <Text numberOfLines={2} style={{ ...type.meta, color: color.fgSecondary }}>
                {r.last}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : (
        <View style={{ gap: space.s, paddingVertical: space.xxl }}>
          <Text style={{ ...type.title, color: color.fgPrimary, textAlign: 'center' }}>{hx.noRequests}</Text>
          <Text style={{ ...type.body, color: color.fgMuted, textAlign: 'center' }}>{hx.noRequestsSub}</Text>
        </View>
      )}
      <Cta tone={color.hookup} title={hx.contact} onPress={() => navigation.navigate('HelpContact')} />
    </ScrollView>
  );
}

type Msg = { from: 'member' | 'support'; body: string; at: string; attachments: string[] };
type Thread = { id: string; ref: string; topic: string; status: string; messages: Msg[] };

/** S-85 thread: support replies in-app (push "support.reply"), member answers, marks solved. */
export function HelpThreadScreen({ navigation, route }: R<{ id: string }>) {
  const id = route.params?.id ?? '';
  const [t, setT] = useState<Thread | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<Thread>('GET', `/support/requests/${id}`).then(setT, () => navigation.goBack()), [id, navigation]);
  useEffect(() => {
    load();
  }, [load]);
  if (!t) return <Loading />;
  const reply = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/support/requests/${id}/messages`, { body: body.trim() });
      setBody('');
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : hx.send);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets {...scroll}>
      <View style={{ gap: space.xs }}>
        <Title>{hx.topicsC[t.topic] ?? t.topic}</Title>
        <Text style={{ ...type.meta, color: color.fgMuted }}>
          {t.ref} · <Text style={{ color: stTone[t.status] }}>{hx.status[t.status] ?? t.status}</Text>
        </Text>
      </View>
      {t.messages.map((m, i) => {
        const us = m.from === 'support';
        return (
          <View key={i} style={{ alignSelf: us ? 'flex-start' : 'flex-end', maxWidth: '88%', gap: space.xs }}>
            <Text style={{ ...type.caption, color: us ? color.hookup : color.fgMuted, alignSelf: us ? 'flex-start' : 'flex-end' }}>
              {us ? hx.support : hx.you} · {new Date(m.at).toLocaleDateString()}
            </Text>
            <View style={{ padding: space.m, borderRadius: radius.md, backgroundColor: us ? color.bgRaised : color.bgOverlay, borderLeftWidth: us ? 3 : 0, borderLeftColor: color.hookup }}>
              <Text selectable style={{ ...type.body, color: color.fgPrimary }}>
                {m.body}
              </Text>
              {m.attachments.map((u) => (
                <Image key={u} source={{ uri: u }} style={{ width: 120, height: 200, borderRadius: radius.sm, marginTop: space.s }} />
              ))}
            </View>
          </View>
        );
      })}
      {t.status === 'solved' ? <Text style={{ ...type.meta, color: color.trust, textAlign: 'center' }}>{hx.solved}</Text> : null}
      <TextInput testID="thread-reply" value={body} onChangeText={setBody} maxLength={4000} multiline placeholder={hx.replyPh} placeholderTextColor={color.fgMuted} style={{ ...input, minHeight: 80 }} />
      {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
      <Cta testID="thread-send" tone={color.trust} title={hx.send} busy={busy} disabled={!body.trim()} onPress={reply} />
      {t.status !== 'solved' ? <Cta testID="thread-solve" kind="ghost" title={hx.solve} onPress={() => api('POST', `/support/requests/${id}/solve`).then(load, () => {})} /> : null}
    </ScrollView>
  );
}

const KINDS = ['idea', 'off', 'love'] as const;
const PARTS = ['explore', 'chats', 'profile', 'location', 'safety', 'plans', 'other'] as const;

/** S-83 Feedback (R-22.30–R-22.34): becomes an anonymous, scrubbed GitHub issue. */
export function HelpFeedbackScreen({ navigation }: R<undefined>) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('idea');
  const [part, setPart] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/feedback', { type: kind, part: part ?? undefined, text: text.trim(), app: { version: app.expo.version, platform: Platform.OS, os: String(Platform.Version), lang } });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === 'validation' && e.fields?.account ? hx.fNew : e.message) : hx.send);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets {...scroll}>
      {done ? (
        <View style={{ gap: space.xl, paddingTop: space.xxl }}>
          <Text style={{ fontSize: 56, textAlign: 'center' }}>💜</Text>
          <Text style={{ ...type.display, textAlign: 'center', color: color.fgPrimary }}>{hx.fThanks}</Text>
          <Cta kind="ghost" title={hx.done} onPress={() => navigation.goBack()} />
        </View>
      ) : (
        <>
          <Title>{hx.tellTeam}</Title>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {KINDS.map((k) => (
              <Pill key={k} testID={`fb-${k}`} label={hx.fType[k]} on={kind === k} tone={color.friends} onPress={() => setKind(k)} />
            ))}
          </View>
          <View style={{ gap: space.s }}>
            <Cap>{hx.part}</Cap>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {PARTS.map((p) => (
                <Pill key={p} label={hx.parts[p]} on={part === p} onPress={() => setPart(part === p ? null : p)} />
              ))}
            </View>
          </View>
          <View style={{ gap: space.s }}>
            <Cap>{hx.fLabel[kind]}</Cap>
            <TextInput testID="fb-text" value={text} onChangeText={setText} maxLength={1000} multiline placeholderTextColor={color.fgMuted} style={{ ...input, minHeight: 140 }} />
            <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{hx.fPrivacy}</Text>
          </View>
          {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
          <Cta testID="fb-send" tone={color.friends} title={hx.send} busy={busy} disabled={text.trim().length < 10} onPress={send} />
        </>
      )}
    </ScrollView>
  );
}
