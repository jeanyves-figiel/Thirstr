import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useFriendPerks } from '../chat/friendPerks';
import { createNavigationContainerRef, DarkTheme, NavigationContainer, StackActions, type NavigationState } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { AppState, Linking, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { kv } from '../chat/kv';
import { AlbumEditScreen, AlbumsScreen, AlbumViewScreen } from '../chat/AlbumScreens';
import { ChatScreen } from '../chat/ChatScreen';
import { getConvs, on, unreadTotal } from '../chat/engine';
import { useTopics } from '../chat/hooks';
import { InboxScreen } from '../chat/InboxScreen';
import { PushPrompt } from '../chat/PushPrompt';
import { ExploreScreen } from '../explore/ExploreScreen';
import { tx } from '../i18n/app';
import { DevicesScreen } from '../me/DevicesScreen';
import { RecoveryScreen } from '../me/RecoveryScreen';
import { backupIfDue } from '../auth/recovery';
import { ensureAttested } from '../auth/attest';
import { EditProfileScreen } from '../me/EditProfileScreen';
import { EditSectionScreen } from '../me/EditSectionScreen';
import { MeScreen } from '../me/MeScreen';
import { backOf, hiddenExpired, stayOf, untilFor } from '../me/hidden';
import { gx } from '../i18n/gestures';
import { toast } from '../ui/Toast';
import { quickLevel } from '../explore/level';
import { LensPreviewScreen } from '../me/LensPreviewScreen';
import { SettingsScreen } from '../me/SettingsScreen';
import { DataSaverSettings } from '../me/settings/DataSaverScreen';
import { ChatBackupSettings, RestoreWordsScreen } from '../me/settings/ChatBackupScreen';
import { backupIfDue as chatBackupIfDue } from '../chat/backup';
import { AccountSettings, ChatSettings, DeleteAccount, NotificationSettings, PrivacySettings, SafetySettings } from '../me/settings/screens';
import { TapsScreen } from '../me/TapsScreen';
import { TripsScreen } from '../travel/TripsScreen';
import { MomentViewerScreen } from '../moments/MomentViewer';
import { MomentNewScreen } from '../moments/MomentNew';
import { ProfileScreen } from '../profile/ProfileScreen';
import { VerifyScreen } from '../screens/Verify';
import { PartyNewScreen } from '../scene/PartyNewScreen';
import { PartyScreen } from '../scene/PartyScreen';
import { resyncHostGroups } from '../scene/groupSync';
import { ActivityNewScreen, ActivityScreen, ClubNewScreen, ClubScreen } from '../scene/SportScreens';
import { TonightScreen } from '../scene/TonightScreen';
import { AppLockScreen } from '../safety/AppLockScreen';
import { CheckinDueScreen, CheckinStartScreen } from '../safety/CheckinScreens';
import { LockGate } from '../safety/LockGate';
import { SafeModeAuto } from '../safety/SafeModeAuto';
import { loadPrefs } from '../me/prefs';
import { startDataSaver } from './dataSaver';
import { feel } from '../ui/haptics';
import { dx } from '../i18n/date';
import { LiveBar, SafetyQuickScreen, useCheckin } from '../safety/live';
import { active as activeCheckin, CATEGORY, extendCheckin, refreshCheckin } from '../safety/safety';
import { useSafetyNative } from '../safety/native';
import { SafetyScreen } from '../safety/SafetyScreen';
import { NoticesScreen } from '../trust/NoticesScreen';
import { ReportScreen } from '../trust/ReportScreen';
import { ToastHost } from '../ui/Toast';
import { HiddenBlockedScreen } from '../trust/HiddenBlockedScreen';
import { VenueScreen } from '../scene/VenueScreens';
import { AddPlaceScreen } from '../scene/AddPlaceScreen';
import { color, modeColor, radius, space, type } from '../theme/tokens';
import { BackButton, Icon, ModeContext, useBottomPanel, useKeyboardShown } from '../ui';
import { useSession } from './session';
import { WhatsNewCard, WhatsNewScreen } from '../whatsnew/WhatsNew';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: color.bgBase, card: color.bgBase, primary: color.hookup, text: color.fgPrimary, border: color.line } };

const TAB_ICON: Record<string, (c: string) => React.ReactNode> = {
  Explore: (c) => <Icon.Pin c={c} />,
  Tonight: (c) => <Icon.Moon c={c} />,
  Chats: (c) => <Icon.Chat c={c} />,
  Me: (c) => <Icon.User c={c} />,
};

const TABS = ['Explore', 'Tonight', 'Chats', 'Me'] as const;
// #137: screens where the nav bar stays hidden (full-screen camera).
// F-21 (#212): Moments viewer and composer are full screen too.
const NO_BAR = new Set(['Verify', 'Moments', 'MomentNew']);

// Pop bottom nav (App v2): white floating pill, icons; active tab grows, shows its label and fills with the mode colour.
// #137: one bar for the whole app, drawn over every screen (pushed screens too); hidden while the keyboard is up.
// The tab under the current screen stays lit; tapping any tab closes pushed screens and opens that tab.
const MODES = ['hookup', 'friends', 'sport'] as const;

// F-19 G16 (#187): holding a tab is a shortcut. Explore: lens picker; Me: Hidden on/off; Chats: first unread chat.
const HOLD_HINT: Record<string, string | undefined> = { Explore: gx.holdExplore, Me: gx.holdMe, Chats: gx.holdChats };

function PillBar({ active, onPick }: { active: string; onPick: (name: string) => void }) {
  const { mode, setMode, me, setMe } = useSession();
  const insets = useSafeAreaInsets();
  const [lens, setLens] = React.useState(false);
  useTopics('convs');
  const unread = unreadTotal();
  const labels: Record<string, string> = { Explore: tx.tabs.explore, Tonight: tx.tabs.tonight, Chats: tx.tabs.chats, Me: tx.tabs.me };

  const hold = (name: string) => {
    if (name === 'Explore') {
      feel('tap');
      setLens(true);
    } else if (name === 'Me') {
      if (!me.verified && !me.hidden) {
        feel('warning');
        toast(gx.hiddenVerify);
        return;
      }
      feel('tap');
      const go = me.hidden ? quickLevel(backOf(me)) : quickLevel('hidden', { until: untilFor(stayOf(me)), return_level: backOf(me) });
      go.then(
        (m) => {
          if (!m) return toast(tx.common.error);
          setMe(m);
          toast(m.hidden ? gx.hiddenOn : gx.hiddenOff);
        },
        () => toast(tx.common.error),
      );
    } else if (name === 'Chats') {
      const c = getConvs().find((x) => x.unread > 0 && !x.archived && !x.muted);
      if (!c) return toast(gx.noUnread);
      feel('tap');
      onPick('Chats');
      if (nav.isReady()) nav.navigate('Chat', { cid: c.id });
    }
  };

  return (
    <>
    {lens ? (
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        <Pressable style={{ flex: 1 }} onPress={() => setLens(false)} accessibilityRole="button" accessibilityLabel={tx.common.close} />
        <View
          testID="tab-lens-picker"
          accessibilityRole="menu"
          accessibilityLabel={gx.lens}
          style={{ position: 'absolute', left: space.l, bottom: insets.bottom + space.s + 64 + space.s, backgroundColor: color.bgInverse, borderRadius: radius.md, padding: 6, gap: 6, minWidth: 180, shadowColor: color.bgBase, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 14 }}
        >
          {MODES.map((m) => (
            <Pressable
              key={m}
              testID={`tab-lens-${m}`}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: m === mode }}
              onPress={() => {
                feel('tick');
                setMode(m);
                setLens(false);
                onPick('Explore');
              }}
              style={{ height: 44, borderRadius: radius.pill, paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: m === mode ? modeColor[m] : 'transparent' }}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: modeColor[m] }} />
              <Text style={{ ...type.headline, fontSize: 15, color: color.onAccent }}>{tx.modes[m]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    ) : null}
    <View
      accessibilityRole="tablist"
      style={{ position: 'absolute', left: space.l, right: space.l, bottom: insets.bottom + space.s, flexDirection: 'row', backgroundColor: color.bgInverse, borderRadius: radius.pill, padding: 6, gap: 4, maxWidth: 520, shadowColor: color.bgBase, shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12, alignSelf: 'center' }}
    >
      {TABS.map((name) => {
        const r = { name };
        const on = active === name;
        return (
          <Pressable
            key={name}
            testID={`tab-${r.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={labels[r.name]}
            onPress={() => {
              feel('tick');
              onPick(r.name);
            }}
            onLongPress={HOLD_HINT[r.name] ? () => hold(r.name) : undefined}
            delayLongPress={400}
            accessibilityHint={HOLD_HINT[r.name]}
            accessibilityActions={HOLD_HINT[r.name] ? [{ name: 'longpress', label: HOLD_HINT[r.name] }] : undefined}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && hold(r.name)}
            style={{ flex: on ? 1.6 : 1, height: 52, borderRadius: radius.pill, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? modeColor[mode] : 'transparent' }}
          >
            {TAB_ICON[r.name]?.(on ? color.onAccent : color.navInactive)}
            {on ? <Text style={{ ...type.headline, fontSize: 13, color: color.onAccent }}>{labels[r.name]}</Text> : null}
            {r.name === 'Chats' && unread > 0 && !on ? (
              <View testID="chats-badge" style={{ position: 'absolute', top: 4, right: 12, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: color.hookup, borderWidth: 2, borderColor: color.bgInverse, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...type.caption, fontSize: 10, color: color.onAccent }}>{unread}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
    </>
  );
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bgBase } }} tabBar={() => null}>
      <Tab.Screen name="Explore" component={ExploreScreen as React.ComponentType} />
      <Tab.Screen name="Tonight" component={TonightScreen as React.ComponentType} />
      <Tab.Screen name="Chats" component={InboxScreen as React.ComponentType} />
      <Tab.Screen name="Me" component={MeScreen as React.ComponentType} />
    </Tab.Navigator>
  );
}

function VerifyRoute({ navigation }: { navigation: { goBack: () => void; replace: (r: string, p?: object) => void } }) {
  const { setMe } = useSession();
  return (
    <VerifyScreen
      onDone={async (m) => {
        setMe(m);
        // #25 R-01.7: offer the recovery phrase once, right after "You're verified".
        if (m.verified && !(await kv.get('recovery:offered'))) {
          await kv.set('recovery:offered', true);
          const st = await api<{ on: boolean }>('GET', '/me/recovery').catch(() => ({ on: true }));
          if (!st.on) return navigation.replace('Recovery', { offer: true });
        }
        navigation.goBack();
      }}
    />
  );
}

const nav = createNavigationContainerRef<Record<string, object | undefined>>();
// Visual audits (#124): web builds made with EXPO_PUBLIC_E2E=1 expose the navigator so a script can open any screen.
if (Platform.OS === 'web' && process.env.EXPO_PUBLIC_E2E === '1') (globalThis as { __nav?: typeof nav }).__nav = nav;

/** #114 R-05.7: when a timed Hidden ends, come back at the chosen level (needs a fresh cell from the phone). */
function useHiddenReturn() {
  const { me, setMe } = useSession();
  React.useEffect(() => {
    if (!me.hidden || !me.hidden_until) return;
    let done = false;
    const back = () => {
      if (done || !hiddenExpired(me)) return;
      done = true;
      quickLevel(backOf(me)).then((m) => m && setMe(m), () => (done = false));
    };
    const ms = Math.max(0, new Date(me.hidden_until).getTime() - Date.now());
    const t = setTimeout(back, Math.min(ms + 1000, 2_147_000_000));
    const s = AppState.addEventListener('change', (st) => st === 'active' && back());
    back();
    return () => {
      clearTimeout(t);
      s.remove();
    };
  }, [me, setMe]);
}

/** #25 App Attest (start + foreground, at most daily) and sealed backup (start + background, at most hourly). */
function useAttestation() {
  React.useEffect(() => {
    ensureAttested();
    backupIfDue();
    chatBackupIfDue(); // R-01.15: daily, Wi-Fi unless allowed on mobile data
    const s = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        ensureAttested();
        chatBackupIfDue();
      } else backupIfDue();
    });
    return () => s.remove();
  }, []);
}

/** F-13: open "All good?" once a check-in is due; keep the held alert's location fresh (5 min). */
function useCheckinWatch() {
  React.useEffect(() => {
    const check = async () => {
      const a = await activeCheckin().catch(() => null);
      if (!a) return;
      if (new Date(a.due).getTime() <= Date.now() && nav.isReady() && nav.getCurrentRoute()?.name !== 'CheckinDue') nav.navigate('CheckinDue');
    };
    // EN-18: timers do nothing while the app is in the background (battery).
    const fg = () => AppState.currentState === 'active';
    const t1 = setInterval(() => fg() && check(), 30_000);
    const t2 = setInterval(() => fg() && refreshCheckin().catch(() => {}), 5 * 60_000);
    const s = AppState.addEventListener('change', (st) => st === 'active' && check());
    let rm: (() => void) | undefined;
    if (Platform.OS !== 'web')
      import('expo-notifications').then((N) => {
        // R-13.19: "All good?" carries I'm OK / +30 min actions.
        N.setNotificationCategoryAsync(CATEGORY, [
          { identifier: 'ok', buttonTitle: dx.actOk, options: { opensAppToForeground: true } },
          { identifier: 'more', buttonTitle: dx.actMore, options: { opensAppToForeground: true } },
        ]).catch(() => {});
        const sub = N.addNotificationResponseReceivedListener((r) => {
          if (!(r.notification.request.content.data as { checkin?: boolean })?.checkin || !nav.isReady()) return;
          if (r.actionIdentifier === 'more') extendCheckin().then(() => nav.isReady() && nav.navigate('SafetyQuick'), () => nav.navigate('CheckinDue'));
          else nav.navigate('CheckinDue');
        });
        rm = () => sub.remove();
      });
    check();
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      s.remove();
      rm?.();
    };
  }, []);
}

/** I-02 R-I02.3: thirstr://p/{slug} and https://<site>/p/{slug} open the profile. */
function useShareLinks() {
  React.useEffect(() => {
    const open = async (url: string | null | undefined) => {
      const m = url?.match(/(?:^thirstr:\/\/p\/|\/p\/)([a-z0-9]{10})(?:[/?#]|$)/);
      if (!m) return;
      const r = await api<{ profile_id: string }>('GET', `/share/${m[1]}`).catch(() => null);
      for (let i = 0; i < 20 && !nav.isReady(); i++) await new Promise((res) => setTimeout(res, 250));
      if (r && nav.isReady()) nav.navigate('Profile', { id: r.profile_id });
    };
    Linking.getInitialURL().then(open);
    const s = Linking.addEventListener('url', (e) => open(e.url));
    return () => s.remove();
  }, []);
}

// App v2 stack header (issue 63): round back button, no bar chrome; screens draw their own 34pt title.
const sub = ({ navigation }: { navigation: { goBack: () => void } }) => ({
  headerShown: true,
  title: '',
  headerStyle: { backgroundColor: color.bgBase },
  headerTintColor: color.fgPrimary,
  headerShadowVisible: false,
  headerBackVisible: false,
  headerLeft: () => (
    <View style={{ marginLeft: Platform.OS === 'web' ? 16 : 0 }}>
      <BackButton onPress={() => navigation.goBack()} label={tx.common.back} />
    </View>
  ),
});

const edgeOnly = { fullScreenGestureEnabled: false };

// S-51 v2 / S-57: sheets drawn by SheetFrame over the current screen.
const sheet = { presentation: 'transparentModal' as const, animation: 'none' as const, contentStyle: { backgroundColor: 'transparent' } };

/** S-56 (R-13.16): live check-in bar above every screen; screens below get a top inset of 0 so nothing is covered. */
function LiveFrame({ children }: { children: React.ReactNode }) {
  const a = useCheckin();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  // Same tree with or without the bar, so the navigator never remounts; the nested provider re-measures natively.
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      {a ? <LiveBar a={a} onOpen={(late) => nav.isReady() && nav.navigate(late ? 'CheckinDue' : 'SafetyQuick')} /> : null}
      <SafeAreaProvider key="live-frame" style={{ flex: 1 }} initialMetrics={{ frame, insets: { ...insets, top: a ? 0 : insets.top } }}>
        {children}
      </SafeAreaProvider>
    </View>
  );
}

export function Main() {
  const { mode } = useSession();
  // Hosts keep party / activity / club group chats in step with their member lists.
  React.useEffect(() => {
    loadPrefs();
    startDataSaver();
    resyncHostGroups().catch(() => {});
    return on('scene', () => {
      resyncHostGroups().catch(() => {});
    });
  }, []);
  useCheckinWatch();
  useAttestation();
  useHiddenReturn();
  useShareLinks();
  // #247: Show me to friends + friend-online alerts (foreground only).
  useFriendPerks();
  // #119 R-13.20: Live Activity + app-icon quick actions + thirstr://safety/* links.
  useSafetyNative(nav);
  const kb = useKeyboardShown();
  const panel = useBottomPanel();
  const [navState, setNavState] = React.useState<NavigationState | undefined>(undefined);
  const top = navState?.routes[navState.index];
  const tabsState = navState?.routes.find((r) => r.name === 'Tabs')?.state;
  const active = TABS[tabsState?.index ?? 0] ?? 'Explore';
  const pick = (name: string) => {
    if (top && top.name !== 'Tabs') nav.dispatch(StackActions.popToTop());
    nav.navigate('Tabs', { screen: name });
  };
  return (
    <ModeContext.Provider value={mode}>
      <LockGate>
      <LiveFrame>
      <NavigationContainer ref={nav} theme={navTheme} onReady={() => setNavState(nav.getRootState() as NavigationState)} onStateChange={(st) => setNavState(st as NavigationState | undefined)}>
        {/* F-19 G14 (#187): iOS swipe back from anywhere; off where the screen has its own sideways gestures (only the edge works there). */}
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bgBase }, fullScreenGestureEnabled: true }}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Profile" component={ProfileScreen as React.ComponentType} options={edgeOnly} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen as React.ComponentType} options={(x) => ({ ...sub(x), ...edgeOnly })} />
          <Stack.Screen name="EditSection" component={EditSectionScreen as React.ComponentType} options={(x) => ({ ...sub(x), ...edgeOnly })} />
          <Stack.Screen name="Settings" component={SettingsScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="PrivacySettings" component={PrivacySettings} options={sub} />
          <Stack.Screen name="ChatSettings" component={ChatSettings} options={sub} />
          <Stack.Screen name="DataSaverSettings" component={DataSaverSettings} options={sub} />
          <Stack.Screen name="ChatBackupSettings" component={ChatBackupSettings as React.ComponentType} options={sub} />
          <Stack.Screen name="RestoreWords" component={RestoreWordsScreen as React.ComponentType} options={{ headerShown: false }} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettings} options={sub} />
          <Stack.Screen name="SafetySettings" component={SafetySettings as React.ComponentType} options={sub} />
          <Stack.Screen name="AccountSettings" component={AccountSettings as React.ComponentType} options={sub} />
          <Stack.Screen name="DeleteAccount" component={DeleteAccount} options={sub} />
          <Stack.Screen name="LensPreview" component={LensPreviewScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Blocked" component={HiddenBlockedScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Taps" component={TapsScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Trips" component={TripsScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Moments" component={MomentViewerScreen as React.ComponentType} options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="MomentNew" component={MomentNewScreen as React.ComponentType} options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="Verify" component={VerifyRoute as React.ComponentType} />
          <Stack.Screen name="Chat" component={ChatScreen as React.ComponentType} options={edgeOnly} />
          <Stack.Screen name="Albums" component={AlbumsScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="AlbumEdit" component={AlbumEditScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Album" component={AlbumViewScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Party" component={PartyScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="PartyNew" component={PartyNewScreen as React.ComponentType} options={{ headerShown: false }} />
          <Stack.Screen name="Activity" component={ActivityScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="ActivityNew" component={ActivityNewScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Club" component={ClubScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="ClubNew" component={ClubNewScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Venue" component={VenueScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="AddPlace" component={AddPlaceScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Report" component={ReportScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="Notices" component={NoticesScreen} options={sub} />
          <Stack.Screen name="Safety" component={SafetyScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="CheckinStart" component={CheckinStartScreen as React.ComponentType} options={sheet} />
          <Stack.Screen name="SafetyQuick" component={SafetyQuickScreen as React.ComponentType} options={sheet} />
          <Stack.Screen name="CheckinDue" component={CheckinDueScreen as React.ComponentType} options={sub} />
          <Stack.Screen name="AppLock" component={AppLockScreen} options={sub} />
          <Stack.Screen name="Devices" component={DevicesScreen} options={sub} />
          <Stack.Screen name="Recovery" component={RecoveryScreen as React.ComponentType} options={{ headerShown: false }} />
          <Stack.Screen name="WhatsNew" component={WhatsNewScreen as React.ComponentType} options={sub} />
        </Stack.Navigator>
        {!kb && !panel && !(top && NO_BAR.has(top.name)) ? <PillBar active={active} onPick={pick} /> : null}
        <PushPrompt />
        {/* F-17 R-17.15 (#238): small card under the Explore header, once per release note, only over a quiet Explore. */}
        <WhatsNewCard
          ready={!kb && !panel && top?.name === 'Tabs' && active === 'Explore'}
          onOpen={(to) => nav.isReady() && (nav.navigate as (r: string, p?: object) => void)(to.route, to.params)}
          onHistory={() => nav.isReady() && nav.navigate('WhatsNew')}
        />
        <ToastHost />
        <SafeModeAuto navigate={(r) => nav.isReady() && nav.navigate(r)} />
      </NavigationContainer>
      </LiveFrame>
      </LockGate>
    </ModeContext.Provider>
  );
}
