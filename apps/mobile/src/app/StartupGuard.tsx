// Last-resort guard: an exception while rendering would otherwise leave a blank screen
// in a release build (no red box). Shows the message so testers can report it.
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { color } from '../theme/tokens';
import { reportError } from './crash';

type State = { error: Error | null };

export class StartupGuard extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Render error', error);
    void reportError(error, true);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorView error={error} />;
  }
}

// Also used by index.ts for errors outside React (module init, fatal async errors).
export function ErrorView({ error }: { error: unknown }) {
  const e = error as { message?: string; stack?: string } | null;
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase, paddingTop: 80, paddingHorizontal: 24 }}>
      <Text style={{ color: color.fgPrimary, fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Something went wrong</Text>
      <Text style={{ color: color.fgSecondary, marginBottom: 16 }}>Please send a screenshot of this screen.</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text selectable style={{ color: color.danger, fontFamily: 'Menlo', fontSize: 12 }}>
          {String(e?.message ?? error)}
          {'\n\n'}
          {e?.stack ?? ''}
        </Text>
      </ScrollView>
    </View>
  );
}
