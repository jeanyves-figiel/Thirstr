import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { tx } from '../i18n/app';
import { DISPUTE_BODIES_URL, dsa } from '../i18n/dsa';
import { color, radius, space, type } from '../theme/tokens';
import { Banner, Button, EmptyState, ErrorText, Field, Loading, Segmented, Sheet } from '../ui';

export type Notice = {
  id: string;
  action: string;
  reason: string;
  at: string;
  ends_at: string | null;
  appeal: string | null;
  seen: boolean;
  // Statement of reasons (DSA Art. 17, F-15 R-15.28)
  ground?: 'tos' | 'law';
  law_ref?: string | null;
  facts?: string | null;
  detected_by?: 'auto' | 'report' | 'staff';
  decided_by?: 'person' | 'auto';
  appeal_until?: string | null;
  appeal_text?: string | null;
  appeal_reason?: string | null;
  appeal_decided_at?: string | null;
};

export type MyReport = {
  id: string;
  ref: string | null;
  reason: string;
  context: string;
  illegal: boolean;
  legal_type: string | null;
  at: string;
  state: 'open' | 'decided';
  decision: string | null;
  decided_at: string | null;
  automated: boolean;
  review: 'open' | 'upheld' | 'overturned' | null;
  review_reason: string | null;
  review_until: string | null;
  seen: boolean;
};

const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const future = (iso?: string | null) => !!iso && new Date(iso).getTime() > Date.now();

const reasonLabel = (r: string) => dsa.reasons[r] ?? tx.notices.reasons[r] ?? tx.notices.reasons.other;

const fmtErr = (e: unknown) => (e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);

// Account status (S-70 › Notices from Thirstr), option A (#170): "About you" holds every action
// with its statement of reasons (S-86, R-15.28) and one review (S-87, R-15.30); "Your reports"
// shows what we decided on each report you made (R-15.27) and a review on "No action" (R-15.32).
export function NoticesScreen() {
  const [tab, setTab] = useState<'you' | 'reports'>('you');
  const [list, setList] = useState<Notice[] | null>(null);
  const [reports, setReports] = useState<MyReport[]>([]);
  const [open, setOpen] = useState<Notice | null>(null);
  const [review, setReview] = useState<{ kind: 'notice' | 'report'; id: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        api<{ notices: Notice[] }>('GET', '/me/notices').then(
          (r) => r.notices,
          () => [] as Notice[],
        ),
        api<{ reports: MyReport[] }>('GET', '/me/reports').then(
          (r) => r.reports,
          () => [] as MyReport[],
        ),
      ]).then(([ns, rs]) => {
        setList(ns);
        setReports(rs);
        // A fresh outcome on a report opens that tab first.
        if (ns.every((n) => n.seen) && rs.some((r) => !r.seen)) setTab('reports');
      }),
    [],
  );

  useEffect(() => {
    load().then(() => api('POST', '/me/notices/seen').catch(() => {}));
  }, [load]);

  useEffect(() => {
    if (tab === 'reports' && reports.some((r) => !r.seen)) api('POST', '/me/reports/seen').catch(() => {});
  }, [tab, reports]);

  const sendReview = async () => {
    if (!review) return;
    setBusy(true);
    setErr(null);
    try {
      const path = review.kind === 'notice' ? `/me/notices/${review.id}/appeal` : `/me/reports/${review.id}/review`;
      await api('POST', path, { text: text.trim() });
      setReview(null);
      setText('');
      await load();
      setOpen((o) => (o ? { ...o, appeal: 'open', appeal_text: text.trim() } : o));
    } catch (e) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  };

  if (!list) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      {open ? (
        <NoticeDetail n={open} onBack={() => setOpen(null)} onReview={() => setReview({ kind: 'notice', id: open.id })} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: 120 }}>
          <Text accessibilityRole="header" style={{ ...type.display, color: color.fgPrimary }}>
            {tx.notices.title}
          </Text>
          <Segmented
            label={tx.notices.title}
            value={tab}
            grow
            onChange={setTab}
            options={[
              { value: 'you', label: dsa.tabYou, badge: list.filter((n) => !n.seen).length },
              { value: 'reports', label: dsa.tabReports(reports.length), badge: reports.filter((r) => !r.seen).length },
            ]}
          />
          {tab === 'you' ? (
            <>
              {list.length === 0 ? <Banner tone="trust" text={tx.notices.none} /> : null}
              {list.map((n) => (
                <Pressable key={n.id} testID={`notice-${n.action}`} accessibilityRole="button" onPress={() => setOpen(n)} style={card}>
                  <Text style={{ ...type.headline, color: n.action === 'warn' ? color.warn : color.danger }}>{tx.notices.actions[n.action] ?? n.action}</Text>
                  <Text style={{ ...type.body, color: color.fgPrimary }}>{tx.notices.rule(reasonLabel(n.reason))}</Text>
                  <Text style={{ ...type.meta, color: color.fgSecondary }}>
                    {date(n.at)}
                    {n.ends_at ? ` · ${tx.notices.until(date(n.ends_at))}` : ''}
                  </Text>
                  {n.appeal ? <Text style={{ ...type.meta, color: color.trust }}>{tx.notices.appealState[n.appeal]}</Text> : null}
                </Pressable>
              ))}
            </>
          ) : reports.length === 0 ? (
            <EmptyState title={dsa.noReports} body={dsa.noReportsSub} />
          ) : (
            <>
              {reports.map((r) => (
                <ReportCard key={r.id} r={r} onReview={() => setReview({ kind: 'report', id: r.id })} />
              ))}
              <Text style={{ ...type.meta, color: color.fgMuted, textAlign: 'center' }}>{dsa.onlyWhat}</Text>
            </>
          )}
        </ScrollView>
      )}
      <Sheet visible={!!review} onClose={() => setReview(null)} title={dsa.reviewTitle} closeLabel={tx.common.close}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{dsa.reviewHint}</Text>
        <Field testID="appeal-text" label={dsa.reviewField} value={text} onChangeText={setText} maxLength={1000} multiline />
        <ErrorText text={err} />
        <Button testID="appeal-send" title={dsa.send} busy={busy} disabled={!text.trim()} onPress={sendReview} />
      </Sheet>
    </View>
  );
}

const card = { padding: space.m, borderRadius: radius.md, backgroundColor: color.bgRaised, gap: space.xs } as const;

function ReportCard({ r, onReview }: { r: MyReport; onReview: () => void }) {
  const what = `${dsa.reported[r.context] ?? dsa.reported.profile} · ${r.legal_type ? dsa.types[r.legal_type] : tx.report.reasons[r.reason] ?? r.reason}`;
  const dec = r.state === 'open' ? 'open' : (r.decision ?? 'no_action');
  const tone = dec === 'open' ? color.warn : dec === 'no_action' ? color.fgSecondary : color.sport;
  const canReview = dec === 'no_action' && !r.review && future(r.review_until);
  return (
    <View testID={`myreport-${dec}`} style={card}>
      <Text style={{ ...type.meta, color: color.fgMuted }}>
        {dateTime(r.at)}
        {r.ref ? ` · ${r.ref}` : ''}
      </Text>
      <Text style={{ ...type.headline, color: color.fgPrimary }}>{what}</Text>
      <Text style={{ ...type.headline, color: tone }}>{dsa.decision[dec] ?? dec}</Text>
      {dec !== 'open' ? <Text style={{ ...type.meta, color: color.fgMuted }}>{r.automated ? dsa.autoHelped : dsa.checkedByTeam}</Text> : null}
      {r.review === 'open' ? <Text style={{ ...type.meta, color: color.trust }}>{dsa.reviewOpen}</Text> : null}
      {r.review === 'upheld' || r.review === 'overturned' ? (
        <Text style={{ ...type.meta, color: color.trust }}>
          {r.review === 'upheld' ? dsa.reviewUpheld : dsa.reviewOverturned}
          {r.review_reason ? ` · ${r.review_reason}` : ''}
        </Text>
      ) : null}
      {canReview ? (
        <>
          <Text style={{ ...type.meta, color: color.fgMuted }}>{dsa.reviewUntil(date(r.review_until!))}</Text>
          <Button testID="report-review" small kind="secondary" title={dsa.askReview} onPress={onReview} />
        </>
      ) : null}
    </View>
  );
}

// S-86 statement of reasons (R-15.28) + review timeline (R-15.33).
function NoticeDetail({ n, onBack, onReview }: { n: Notice; onBack: () => void; onReview: () => void }) {
  const reversed = n.appeal === 'overturned';
  const kept = n.appeal === 'upheld';
  const head = reversed ? color.trust : n.action === 'warn' ? color.warn : color.danger;
  const scope =
    n.action === 'suspend' && n.ends_at
      ? dsa.scope.suspend(dateTime(n.ends_at))
      : n.action === 'warn' || n.action === 'remove_photo' || n.action === 'hide_field' || n.action === 'ban'
        ? dsa.scope[n.action]
        : '';
  const canReview = !n.appeal && (n.appeal_until ? future(n.appeal_until) : true);
  return (
    <ScrollView testID="notice-detail" showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: 120 }}>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={12}>
        <Text style={{ ...type.headline, color: color.fgSecondary }}>‹ {tx.notices.title}</Text>
      </Pressable>
      <View style={{ borderRadius: radius.md, padding: space.m, flexDirection: 'row', gap: space.m, alignItems: 'center', backgroundColor: color.bgRaised, borderLeftWidth: 0 }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: head, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...type.headline, color: color.onAccent }}>{reversed ? '↺' : '!'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.headline, color: color.fgPrimary }}>{reversed ? dsa.reversedTitle : kept ? dsa.keptTitle : (tx.notices.actions[n.action] ?? n.action)}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{dateTime(n.at)}</Text>
        </View>
      </View>
      {reversed ? <Banner tone="trust" text={dsa.reversedBody} /> : null}
      <View style={{ ...card, gap: space.m }}>
        {scope ? <Block k={dsa.whatK} v={scope} /> : null}
        <Block k={dsa.whyK} v={n.ground === 'law' && n.law_ref ? dsa.law(n.law_ref) : dsa.rule(reasonLabel(n.reason))} />
        {n.facts ? <Block k={dsa.factsK} v={n.facts} /> : null}
        <View style={{ gap: space.xs }}>
          <Text style={kLabel}>{dsa.howK}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            <Pill text={dsa.foundBy[n.detected_by ?? 'staff']} />
            <Pill text={dsa.decidedBy[n.decided_by ?? 'person']} />
          </View>
        </View>
        {n.reason === 'report_misuse' && !reversed ? <Block k={dsa.nextK} v={dsa.misuseNext} /> : null}
        <View style={{ gap: space.xs }}>
          <Text style={kLabel}>{dsa.canK}</Text>
          {canReview ? (
            <>
              {n.appeal_until ? <Text style={{ ...type.body, color: color.fgPrimary }}>{dsa.reviewUntil(date(n.appeal_until))}</Text> : null}
              <Button testID={`appeal-${n.action}`} small kind="secondary" title={dsa.askReview} onPress={onReview} />
            </>
          ) : null}
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(DISPUTE_BODIES_URL)}>
            <Text style={{ ...type.body, color: color.trust }}>{dsa.bodies}</Text>
          </Pressable>
          <Text style={{ ...type.body, color: color.fgSecondary }}>{dsa.court}</Text>
        </View>
      </View>
      {n.appeal ? (
        <View testID="notice-timeline" style={{ ...card, gap: space.s }}>
          <Text style={kLabel}>{dsa.timeline}</Text>
          <Step dot={color.trust} title={dsa.tDecided} sub={dateTime(n.at)} />
          <Step dot={color.warn} title={dsa.tAsked} sub={n.appeal_text ? `“${n.appeal_text}”` : ''} />
          {n.appeal !== 'open' ? (
            <Step dot={color.trust} title={dsa.tReviewed} sub={[n.appeal_decided_at ? dateTime(n.appeal_decided_at) : '', n.appeal_reason ?? ''].filter(Boolean).join(' · ')} />
          ) : (
            <Text style={{ ...type.meta, color: color.trust }}>{tx.notices.appealState.open}</Text>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const kLabel = { ...type.caption, color: color.fgMuted, letterSpacing: 0.8, textTransform: 'uppercase' } as const;

function Block({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={kLabel}>{k}</Text>
      <Text style={{ ...type.body, color: color.fgPrimary }}>{v}</Text>
    </View>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <View style={{ borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: space.xs, backgroundColor: color.bgOverlay }}>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{text}</Text>
    </View>
  );
}

function Step({ dot, title, sub }: { dot: string; title: string; sub: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-start' }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot, marginTop: 5 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.body, color: color.fgPrimary }}>{title}</Text>
        {sub ? <Text style={{ ...type.meta, color: color.fgMuted }}>{sub}</Text> : null}
      </View>
    </View>
  );
}
