// EN-14 (#173): shown instead of the app when this build is below the server's minimum.
// Same onboarding shell as the other full-screen states (Underage). Chats stay on the phone.
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { o } from '../i18n/onboarding';
import { StepShell } from '../onboarding/kit';
import { color, font, radius } from '../theme/tokens';

export function UpdateRequiredScreen({ storeUrl }: { storeUrl: string | null }) {
  return (
    <StepShell
      title={o.update.title}
      sub={o.update.body}
      cta={storeUrl ? { title: o.update.cta, onPress: () => Linking.openURL(storeUrl).catch(() => {}), testID: 'update-cta' } : undefined}
    >
      <View style={s.badge} accessibilityElementsHidden>
        <Text style={s.arrow}>↑</Text>
      </View>
    </StepShell>
  );
}

const s = StyleSheet.create({
  badge: { marginTop: 40, alignSelf: 'center', width: 132, height: 132, borderRadius: radius.lg, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontFamily: font.heavy, fontSize: 64, color: color.trust },
});
