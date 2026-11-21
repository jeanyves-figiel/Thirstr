import React from 'react';
import { View } from 'react-native';
import { tx } from '../i18n/app';
import { color } from '../theme/tokens';
import { EmptyState } from '../ui';

// Placeholder for parts landing in the next milestone PRs of the same beta (issue 37).
export function Soon() {
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase, justifyContent: 'center' }}>
      <EmptyState title={tx.soon.title} body={tx.soon.body} />
    </View>
  );
}
