// #210 Tonight cards with actions ([mockup](https://claude.ai/artifact/1YSABPxLq3S7pMxGoEwwbW), all six picked).
// Plan: I'm in · Tap · Chat, ⋯ / hold = safety sheet, swipe left = hide plan.
// Party: Request a seat · Map, ⋯ = Hide party / Report, seat bar and house rules on the card.
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api, ApiError } from "../api/client";
import { distanceLabel, tx } from "../i18n/app";
import { color, font, radius, space, type } from "../theme/tokens";
import { Icon, Photo, VerifiedTick, useAccent } from "../ui";
import { feel } from "../ui/haptics";
import { SwipeRow } from "../ui/SwipeRow";
import { toast } from "../ui/Toast";
import { mod } from "../i18n/mod";
import { hideItem, unhideItem } from "./hiddenItems";
import type { Party, Plan } from "./types";
import { day, time } from "./types";

const c = tx.tonight.card;

function MoreBtn({
  onPress,
  label,
  testID,
}: {
  onPress: () => void;
  label: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: color.bgOverlay,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon.More size={18} />
    </Pressable>
  );
}

/** One pill action; `pri` = mode fill, `done` = teal confirmation state. */
export function CardAction({
  label,
  icon,
  onPress,
  pri,
  done,
  disabled,
  testID,
}: {
  label: string;
  icon?: (c: string) => React.ReactNode;
  onPress: () => void;
  pri?: boolean;
  done?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const accent = useAccent();
  const fg = done ? color.trust : pri ? color.onAccent : color.fgPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!done }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 44,
        borderRadius: radius.pill,
        paddingHorizontal: space.s,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: done
          ? `${color.trust}29`
          : pri
            ? accent
            : color.bgOverlay,
        opacity: disabled ? 0.5 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {icon ? icon(fg) : null}
      <Text
        numberOfLines={1}
        style={{ fontFamily: font.bold, fontSize: 14, color: fg }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type PlanProps = {
  p: Plan;
  tapped: boolean;
  onProfile: () => void;
  onChat: (draft?: string) => void;
  onTap: () => void;
  onMenu: () => void;
};

export function PlanCard({
  p,
  tapped,
  onProfile,
  onChat,
  onTap,
  onMenu,
}: PlanProps) {
  const accent = useAccent();
  const line = p.text || tx.tonight.tags[p.tag];
  const hide = () => {
    hideItem(p.id, p.window_end);
    toast(c.planHidden, { label: mod.undo, on: () => unhideItem(p.id) });
  };
  return (
    <SwipeRow
      testID={`plan-swipe-${p.profile.display_name}`}
      right={[
        {
          key: "hide",
          label: c.hidePlan,
          icon: <Icon.EyeOff size={20} c={color.onAccent} />,
          fill: color.fgMuted,
          on: hide,
        },
      ]}
    >
      <Pressable
        testID={`plan-${p.profile.display_name}`}
        onLongPress={() => {
          feel("tap");
          onMenu();
        }}
        delayLongPress={400}
        accessibilityActions={[{ name: "longpress", label: c.more }]}
        onAccessibilityAction={(e) =>
          e.nativeEvent.actionName === "longpress" && onMenu()
        }
        style={{
          padding: space.l,
          borderRadius: 22,
          backgroundColor: color.bgRaised,
          gap: space.m,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.m }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={onProfile}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: space.m,
            }}
          >
            <Photo
              uri={p.profile.photo}
              id={p.profile.id}
              label=""
              style={{ width: 44, height: 44, borderRadius: 22 }}
            />
            <View style={{ flex: 1 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Text
                  style={{ ...type.headline, color: color.fgPrimary }}
                  numberOfLines={1}
                >
                  {p.profile.display_name}, {p.profile.age}
                </Text>
                {p.profile.verified ? <VerifiedTick size={13} /> : null}
              </View>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>
                {distanceLabel(p.distance)} · {time(p.window_start)}–
                {time(p.window_end)}
              </Text>
            </View>
          </Pressable>
          <MoreBtn
            testID={`plan-more-${p.profile.display_name}`}
            onPress={onMenu}
            label={c.more}
          />
        </View>
        <Text
          style={{
            ...type.body,
            fontSize: 17,
            lineHeight: 23,
            color: color.fgPrimary,
          }}
        >
          {line}
        </Text>
        {p.text ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                height: 24,
                paddingHorizontal: 10,
                borderRadius: radius.pill,
                justifyContent: "center",
                backgroundColor: `${accent}2E`,
              }}
            >
              <Text
                style={{ fontFamily: font.bold, fontSize: 12, color: accent }}
              >
                {tx.tonight.tags[p.tag]}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: space.s }}>
          <CardAction
            testID={`plan-in-${p.profile.display_name}`}
            pri
            label={c.imIn}
            icon={(k) => <Icon.Check size={16} c={k} />}
            onPress={() => onChat(c.imInDraft(line))}
          />
          <CardAction
            testID={`plan-tap-${p.profile.display_name}`}
            done={tapped}
            label={tapped ? c.tapped : c.tap}
            icon={(k) => <Icon.Flame size={18} c={k} />}
            onPress={onTap}
            disabled={tapped}
          />
          <CardAction
            label={c.chat}
            icon={(k) => <Icon.Chat size={18} c={k} />}
            onPress={() => onChat()}
          />
        </View>
      </Pressable>
    </SwipeRow>
  );
}

type PartyProps = {
  p: Party;
  verified: boolean;
  onOpen: () => void;
  onMap: () => void;
  onMenu: () => void;
  onChanged: () => void;
};

export function PartyCard({
  p,
  verified,
  onOpen,
  onMap,
  onMenu,
  onChanged,
}: PartyProps) {
  const accent = useAccent();
  const [state, setState] = useState(p.my_state);
  const [busy, setBusy] = useState(false);
  // A new list from the server wins over the local state.
  const [seen, setSeen] = useState(p.my_state);
  if (seen !== p.my_state) {
    setSeen(p.my_state);
    setState(p.my_state);
  }
  const full = p.status === "full" || p.seats_taken >= p.capacity;
  const live = p.status !== "ended" && p.status !== "cancelled";
  const rules = p.rules.map((r) => tx.party.rule[r] ?? r);
  const request = async () => {
    setBusy(true);
    try {
      await api("POST", `/parties/${p.id}/request`, {});
      feel("success");
      setState("pending");
      onChanged();
    } catch (e) {
      toast(
        e instanceof ApiError
          ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message)
          : tx.common.error,
      );
    } finally {
      setBusy(false);
    }
  };
  const main =
    state === "host" ? null : state === "accepted" ? (
      <CardAction
        testID={`party-in-${p.title}`}
        done
        label={c.youreIn}
        icon={(k) => <Icon.Chat size={18} c={k} />}
        onPress={onOpen}
      />
    ) : state === "pending" ? (
      <CardAction
        testID={`party-requested-${p.title}`}
        done
        label={c.requested}
        icon={(k) => <Icon.Check size={16} c={k} />}
        onPress={onOpen}
      />
    ) : (
      <CardAction
        testID={`party-request-${p.title}`}
        pri
        label={full ? c.full : busy ? "…" : c.requestSeat}
        icon={full ? undefined : (k) => <Icon.Plus size={16} c={k} />}
        disabled={
          full || busy || !live || !verified || state === "not_this_time"
        }
        onPress={request}
      />
    );
  return (
    <Pressable
      testID={`party-${p.title}`}
      accessibilityRole="button"
      onPress={onOpen}
      onLongPress={() => {
        feel("tap");
        onMenu();
      }}
      delayLongPress={400}
      style={{
        padding: space.l,
        borderRadius: 22,
        backgroundColor: color.bgRaised,
        gap: space.s,
        borderWidth: 2,
        borderColor: accent,
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.s }}
      >
        <View
          style={{
            paddingHorizontal: 10,
            height: 24,
            borderRadius: radius.pill,
            backgroundColor: accent,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              ...type.caption,
              color: color.onAccent,
              textTransform: "uppercase",
            }}
          >
            {tx.party.status[p.status]}
          </Text>
        </View>
        <Text
          style={{
            ...type.caption,
            color: color.fgSecondary,
            marginLeft: "auto",
          }}
        >
          {tx.party.seats(p.seats_taken, p.capacity)}
        </Text>
        {state !== "host" ? (
          <MoreBtn
            testID={`party-more-${p.title}`}
            onPress={onMenu}
            label={c.more}
          />
        ) : null}
      </View>
      <Text
        style={{
          ...type.title,
          fontSize: 24,
          lineHeight: 28,
          color: color.fgPrimary,
        }}
      >
        {p.title}
      </Text>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>
        {day(p.starts_at)}–{time(p.ends_at)} · {distanceLabel(p.distance)} ·{" "}
        {p.host.display_name}
      </Text>
      {rules.length ? (
        <Text
          style={{ ...type.meta, fontSize: 12, color: color.fgMuted }}
          numberOfLines={2}
        >
          {rules.join(" · ")}
        </Text>
      ) : null}
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: color.bgOverlay,
          overflow: "hidden",
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          style={{
            height: 6,
            width: `${Math.min(100, (p.seats_taken / Math.max(1, p.capacity)) * 100)}%`,
            backgroundColor: accent,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", gap: space.s, marginTop: space.xs }}>
        {main}
        <CardAction
          testID={`party-map-${p.title}`}
          label={c.map}
          icon={(k) => <Icon.Pin size={18} c={k} />}
          onPress={onMap}
        />
      </View>
    </Pressable>
  );
}
