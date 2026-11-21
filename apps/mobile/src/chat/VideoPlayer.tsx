// S-43 video viewer (F-08 R-08.17, #138): full screen, native controls, plays from a decrypted temp file
// that is deleted when the viewer closes. No picture-in-picture, no background play, no AirPlay.
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tx } from '../i18n/app';
import { mmss, mx } from '../i18n/media';
import { color, radius, space, type } from '../theme/tokens';
import { Icon } from '../ui';
import { openTemp, Temp } from './video';

type Ref = { blob: string; key: string; iv: string; mime: string; once?: boolean; exp?: number };

export function VideoPlayer({ item, onClose, footer }: { item: Ref | null; onClose: () => void; footer?: React.ReactNode }) {
  return (
    <Modal visible={!!item} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {item ? <Stage item={item} onClose={onClose} footer={footer} /> : null}
    </Modal>
  );
}

function Stage({ item, onClose, footer }: { item: Ref; onClose: () => void; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [temp, setTemp] = useState<Temp | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    let t: Temp | null = null;
    openTemp(item).then(
      (x) => {
        t = x;
        if (live) setTemp(x);
        else x.done();
      },
      () => live && setErr(true),
    );
    return () => {
      live = false;
      t?.done();
    };
  }, [item]);
  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      {temp ? <Play uri={temp.uri} /> : null}
      {!temp && !err ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m }}>
          <ActivityIndicator color={color.fgPrimary} />
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{mx.preparing}</Text>
        </View>
      ) : null}
      {err ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
          <Text style={{ ...type.body, color: color.fgSecondary, textAlign: 'center' }}>{mx.videoError}</Text>
        </View>
      ) : null}
      <Pressable
        testID="video-close"
        accessibilityRole="button"
        accessibilityLabel={tx.common.close}
        onPress={onClose}
        hitSlop={10}
        style={{ position: 'absolute', top: insets.top + space.s, right: space.l, width: 40, height: 40, borderRadius: 20, backgroundColor: color.glass, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon.Close />
      </Pressable>
      {footer ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 80, alignItems: 'center' }}>{footer}</View> : null}
    </View>
  );
}

function Play({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri, useCaching: false }, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" allowsPictureInPicture={false} />;
}

/** Dark tile with ▶ and length, used in bubbles, albums and the camera roll. Nothing is decrypted to show it. */
export function VideoMark({ dur, small }: { dur?: number; small?: boolean }) {
  const s = small ? 22 : 44;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color.glass, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: color.fgPrimary, fontSize: small ? 10 : 18, marginLeft: small ? 2 : 3 }}>▶</Text>
      </View>
      {dur != null ? (
        <View style={{ position: 'absolute', right: small ? 4 : 8, bottom: small ? 4 : 8, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: color.glass }}>
          <Text style={{ ...type.caption, fontSize: small ? 9 : 11, lineHeight: small ? 12 : 15, color: color.fgPrimary }}>{mmss(dur)}</Text>
        </View>
      ) : null}
    </View>
  );
}

