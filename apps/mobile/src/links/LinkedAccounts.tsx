// I-01 S-63 / S-63b (#17): linked accounts with proof. List → platform → handle + who sees it →
// prove (code in bio, or Sign in with X). Server checks; the phone never fetches these pages.
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, ApiError } from "../api/client";
import { useSession } from "../app/session";
import { lx } from "../i18n/links";
import { tx } from "../i18n/app";
import { color, font, radius, space, type } from "../theme/tokens";
import { ErrorText } from "../ui";
import { toast } from "../ui/Toast";
import { Glyph } from "./LinkCard";
import { adultAllowed, isAdult, PLATFORM_NAME, type Platform } from "./links";

export type Linked = {
  id: string;
  platform: Platform;
  handle: string;
  visibility: string;
  verified: boolean;
  proof?: string;
  state?: string;
  hidden?: boolean;
  code?: string;
};
const ALL: Platform[] = ["bluesky", "x", "onlyfans", "jff", "instagram"];
const VIS = ["chats", "verified", "everyone"];
const EDIT_URL: Partial<Record<Platform, string>> = {
  bluesky: "https://bsky.app/settings",
  onlyfans: "https://onlyfans.com/my/settings/profile",
  jff: "https://justfor.fans",
};

const stateOf = (l: Linked) =>
  l.verified
    ? "proven"
    : l.platform === "instagram"
      ? "none"
      : (l.state ?? "unproven");
const pill: Record<string, { bg: string; fg: string }> = {
  proven: { bg: color.trust, fg: color.onAccent },
  manual_pending: { bg: color.personal, fg: color.onAccent },
  unproven: { bg: color.bgOverlay, fg: color.fgSecondary },
  none: { bg: color.bgOverlay, fg: color.fgSecondary },
};

const errMsg = (e: unknown) =>
  e instanceof ApiError
    ? e.code === "taken"
      ? lx.taken
      : (Object.values(e.fields ?? {})[0]?.[0] ?? e.message)
    : tx.common.error;

/** Edit profile hub row (R-I01.14): "2 linked · 1 ✓". */
export function LinkedRow({
  profileId,
  onOpen,
}: {
  profileId: string;
  onOpen: () => void;
}) {
  const [list, setList] = useState<Linked[] | null>(null);
  useEffect(() => {
    api<{ linked: Linked[] }>(
      "GET",
      `/me/profiles/${profileId}/linked-accounts`,
    ).then(
      (r) => setList(r.linked),
      () => setList([]),
    );
  }, [profileId]);
  const n = list?.length ?? 0;
  const ok = list?.filter((l) => l.verified).length ?? 0;
  return (
    <Pressable
      testID="linked-row"
      accessibilityRole="button"
      accessibilityLabel={`${lx.title}, ${lx.rowSummary(n, ok)}`}
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        minHeight: 60,
        paddingHorizontal: space.l,
        borderRadius: radius.md,
        backgroundColor: pressed ? color.bgOverlay : color.bgRaised,
      })}
    >
      <View style={{ flexDirection: "row" }}>
        {(list?.length
          ? list.slice(0, 3).map((l) => l.platform)
          : (["bluesky", "x"] as Platform[])
        ).map((p, i) => (
          <View
            key={p + i}
            style={{
              marginLeft: i ? -8 : 0,
              borderRadius: 9,
              borderWidth: 2,
              borderColor: color.bgRaised,
            }}
          >
            <Glyph p={p} size={24} />
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.headline, color: color.fgPrimary }}>
          {lx.title}
        </Text>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>
          {list ? lx.rowSummary(n, ok) : " "}
        </Text>
      </View>
      <Text style={{ ...type.headline, color: color.fgMuted }}>›</Text>
    </Pressable>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <Text
      accessibilityRole="header"
      style={{ ...type.display, color: color.fgPrimary, letterSpacing: -1 }}
    >
      {children}
    </Text>
  );
}

function Primary({
  title,
  onPress,
  tone = color.trust,
  testID,
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  tone?: string;
  testID?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        height: 56,
        borderRadius: 28,
        backgroundColor: disabled ? color.bgRaised : tone,
        alignItems: "center",
        justifyContent: "center",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Text
        style={{
          ...type.headline,
          fontSize: 17,
          color: disabled ? color.fgMuted : color.onAccent,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Ghost({
  title,
  onPress,
  danger,
}: {
  title: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: color.line,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.l,
      }}
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

function VisPick({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: "row",
        backgroundColor: color.bgRaised,
        borderRadius: 22,
        padding: 4,
      }}
    >
      {VIS.map((v) => (
        <Pressable
          key={v}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === v }}
          onPress={() => onChange(v)}
          style={{
            flex: 1,
            minHeight: 40,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: value === v ? color.bgInverse : "transparent",
          }}
        >
          <Text
            style={{
              ...type.meta,
              fontFamily: font.bold,
              color: value === v ? color.onAccent : color.fgSecondary,
            }}
          >
            {tx.linked.vis[v]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type Step =
  | { kind: "list" }
  | { kind: "platform" }
  | { kind: "handle"; p: Platform }
  | { kind: "prove"; l: Linked; msg?: string };

export function LinkedAccountsScreen({
  route,
}: {
  route: { params: { profileId: string } };
}) {
  const { profileId } = route.params;
  const { me } = useSession();
  const safe = me.safe_mode === "on" || !!me.safe_mode_active;
  const [list, setList] = useState<Linked[]>([]);
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [handle, setHandle] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [vis, setVis] = useState("chats");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ linked: Linked[] }>(
        "GET",
        `/me/profiles/${profileId}/linked-accounts`,
      ).then(
        (r) => (setList(r.linked), r.linked),
        () => [] as Linked[],
      ),
    [profileId],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async <T,>(f: () => Promise<T>) => {
    setErr(null);
    setBusy(true);
    try {
      return await f();
    } catch (e) {
      setErr(errMsg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  // R-I01.28 / R-I01.30: no OnlyFans / JustFor.Fans tiles in Safe Mode or on the store-review build.
  const offered = ALL.filter((p) => !isAdult(p) || adultAllowed(safe)).filter(
    (p) => !list.some((l) => l.platform === p),
  );

  const add = (p: Platform) =>
    run(async () => {
      const r = await api<{ id: string; proof_method: string; code?: string }>(
        "POST",
        "/me/linked-accounts",
        { profile_id: profileId, platform: p, handle, visibility: vis },
      );
      const all = await load();
      const l = all.find((x) => x.id === r.id);
      setHandle("");
      if (isAdult(p) && vis === "everyone") toast(lx.creatorNote);
      if (
        l &&
        (r.proof_method === "bio_code" || r.proof_method === "post_code")
      )
        setStep({ kind: "prove", l: { ...l, code: r.code } });
      else setStep({ kind: "list" });
    });

  const check = (l: Linked) =>
    run(async () => {
      // R-I01.17: X proof = the code in a public post; the member pastes the post link.
      const r = await api<{ state: string }>(
        "POST",
        `/me/linked-accounts/${l.id}/verify`,
        l.platform === "x" ? { post_url: postUrl.trim() } : undefined,
      );
      await load();
      setStep({
        kind: "prove",
        l: { ...l, state: r.state, verified: r.state === "proven" },
        msg:
          r.state === "proven"
            ? lx.found
            : r.state === "manual_pending"
              ? lx.manual
              : lx.notFound(l.handle),
      });
    });

  if (step.kind === "platform" || step.kind === "handle") {
    const p = step.kind === "handle" ? step.p : null;
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.l, gap: space.l }}
      >
        <Text style={{ ...type.meta, color: color.fgSecondary }}>
          {lx.step(p ? 2 : 1)}
        </Text>
        <H>{p ? PLATFORM_NAME[p] : lx.pickPlatform}</H>
        {!p ? (
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}
          >
            {offered.map((x) => (
              <Pressable
                key={x}
                testID={`linked-pick-${x}`}
                accessibilityRole="button"
                onPress={() => setStep({ kind: "handle", p: x })}
                style={{
                  width: "47%",
                  minHeight: 88,
                  borderRadius: radius.md,
                  backgroundColor: color.bgRaised,
                  padding: space.m,
                  gap: space.s,
                  justifyContent: "center",
                }}
              >
                <Glyph p={x} size={32} />
                <Text style={{ ...type.headline, color: color.fgPrimary }}>
                  {PLATFORM_NAME[x]}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <View style={{ gap: space.m }}>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>
                {lx.handleLabel}
              </Text>
              <TextInput
                testID="linked-handle"
                value={handle}
                onChangeText={setHandle}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={200}
                placeholder="@"
                accessibilityLabel={lx.handleLabel}
                placeholderTextColor={color.fgMuted}
                style={{
                  height: 52,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: color.line,
                  backgroundColor: color.bgRaised,
                  color: color.fgPrimary,
                  paddingHorizontal: 14,
                  fontFamily: font.regular,
                  fontSize: 16,
                }}
              />
              <Text style={{ ...type.meta, color: color.fgSecondary }}>
                {lx.whoSees}
              </Text>
              <VisPick value={vis} onChange={setVis} />
              {p === "instagram" ? (
                <Text style={{ ...type.meta, color: color.fgSecondary }}>
                  {lx.igNote}
                </Text>
              ) : null}
              <Primary
                busy={busy}
                testID="linked-save"
                title={lx.next}
                disabled={!handle.trim()}
                onPress={() => add(p)}
              />
            </View>
          </>
        )}
        <ErrorText text={err} />
        <Ghost title={lx.cancel} onPress={() => setStep({ kind: "list" })} />
      </ScrollView>
    );
  }

  if (step.kind === "prove") {
    const l = list.find((x) => x.id === step.l.id) ?? step.l;
    const code = step.l.code ?? l.code;
    return (
      <ScrollView contentContainerStyle={{ padding: space.l, gap: space.l }}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>
          {lx.step(3)} · {PLATFORM_NAME[l.platform]} · @{l.handle}
        </Text>
        <H>{lx.proveTitle}</H>
        <Text style={{ ...type.body, color: color.fgSecondary }}>
          {l.platform === "bluesky"
            ? lx.proveBsky
            : l.platform === "x"
              ? lx.proveX
              : lx.proveBody(PLATFORM_NAME[l.platform])}
        </Text>
        {code && !l.verified ? (
          <View
            style={{
              borderRadius: 18,
              backgroundColor: color.bgRaised,
              padding: space.l,
              alignItems: "center",
              gap: space.m,
            }}
          >
            <Text
              testID="linked-code"
              selectable
              style={{
                fontFamily: font.heavy,
                fontSize: 28,
                color: color.trust,
                fontVariant: ["tabular-nums"],
              }}
            >
              {code}
            </Text>
            <View
              style={{
                flexDirection: "row",
                gap: space.s,
                alignSelf: "stretch",
              }}
            >
              <View style={{ flex: 1 }}>
                <Ghost
                  title={lx.copyShort}
                  onPress={() =>
                    Clipboard.setStringAsync(code).then(
                      () => toast(lx.copied),
                      () => {},
                    )
                  }
                />
              </View>
              {l.platform === "x" ? (
                <View style={{ flex: 1 }}>
                  <Ghost
                    title={lx.postOnX}
                    onPress={() =>
                      Linking.openURL(
                        `https://x.com/intent/post?text=${encodeURIComponent(code)}`,
                      ).catch(() => {})
                    }
                  />
                </View>
              ) : EDIT_URL[l.platform] ? (
                <View style={{ flex: 1 }}>
                  <Ghost
                    title={lx.openPlatform(PLATFORM_NAME[l.platform])}
                    onPress={() =>
                      Linking.openURL(EDIT_URL[l.platform]!).catch(() => {})
                    }
                  />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
        {l.platform === "x" && !l.verified ? (
          <TextInput
            testID="linked-post-url"
            value={postUrl}
            onChangeText={setPostUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={300}
            placeholder="https://x.com/…/status/…"
            accessibilityLabel={lx.postLink}
            placeholderTextColor={color.fgMuted}
            style={{
              height: 52,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: color.line,
              backgroundColor: color.bgRaised,
              color: color.fgPrimary,
              paddingHorizontal: 14,
              fontFamily: font.regular,
              fontSize: 16,
            }}
          />
        ) : null}
        {step.msg ? (
          <Text
            style={{
              ...type.body,
              color: l.verified
                ? color.trust
                : l.state === "manual_pending"
                  ? color.personal
                  : color.fgSecondary,
            }}
          >
            {step.msg}
          </Text>
        ) : null}
        <ErrorText text={err} />
        {!l.verified && l.state !== "manual_pending" ? (
          <Primary
            busy={busy}
            testID="linked-check"
            title={lx.checkNow}
            disabled={l.platform === "x" && !postUrl.trim()}
            onPress={() => check(l)}
          />
        ) : null}
        <Ghost
          title={
            l.verified || l.state === "manual_pending"
              ? tx.common.save
              : lx.later
          }
          onPress={() => setStep({ kind: "list" })}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, gap: space.l }}>
      <H>{lx.title}</H>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{lx.hint}</Text>
      {list.length ? (
        <View
          style={{
            borderRadius: 18,
            backgroundColor: color.bgRaised,
            overflow: "hidden",
          }}
        >
          {list.map((l, i) => {
            const st = stateOf(l);
            return (
              <View
                key={l.id}
                testID={`linked-${l.platform}`}
                style={{
                  padding: space.m,
                  gap: space.s,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: color.line,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <Glyph p={l.platform} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ ...type.headline, color: color.fgPrimary }}
                    >
                      @{l.handle}
                    </Text>
                    <Text style={{ ...type.meta, color: color.fgSecondary }}>
                      {PLATFORM_NAME[l.platform]} ·{" "}
                      {tx.linked.vis[l.visibility]}
                    </Text>
                  </View>
                  <View
                    style={{
                      borderRadius: 13,
                      paddingHorizontal: 10,
                      height: 26,
                      justifyContent: "center",
                      backgroundColor: pill[st].bg,
                    }}
                  >
                    <Text style={{ ...type.caption, color: pill[st].fg }}>
                      {lx.states[st]}
                    </Text>
                  </View>
                </View>
                {l.hidden ? (
                  <Text style={{ ...type.meta, color: color.warn }}>
                    {lx.hiddenByReports}
                  </Text>
                ) : null}
                <VisPick
                  value={l.visibility}
                  onChange={(v) =>
                    run(() =>
                      api("PATCH", `/me/linked-accounts/${l.id}`, {
                        visibility: v,
                      }).then(load),
                    )
                  }
                />
                <View
                  style={{
                    flexDirection: "row",
                    gap: space.s,
                    flexWrap: "wrap",
                  }}
                >
                  {st === "unproven" ? (
                    <Ghost
                      title={lx.proveTitle}
                      onPress={() => setStep({ kind: "prove", l })}
                    />
                  ) : null}
                  <Ghost
                    danger
                    title={lx.remove}
                    onPress={() =>
                      run(() =>
                        api("DELETE", `/me/linked-accounts/${l.id}`).then(load),
                      )
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {list.length < 5 && offered.length ? (
        <Pressable
          testID="linked-add"
          accessibilityRole="button"
          onPress={() => (setVis("chats"), setStep({ kind: "platform" }))}
          style={{
            height: 56,
            borderRadius: 28,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: color.line,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ ...type.headline, color: color.fgPrimary }}>
            ＋ {lx.addCta}
          </Text>
        </Pressable>
      ) : null}
      <Text style={{ ...type.meta, color: color.fgMuted, textAlign: "center" }}>
        {lx.ofMax(list.length)}
      </Text>
      <ErrorText text={err} />
      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: color.line,
          padding: space.m,
        }}
      >
        <Text style={{ ...type.meta, color: color.fgSecondary }}>
          🛡 {lx.adultNote}
        </Text>
      </View>
    </ScrollView>
  );
}
