import { UiProvider } from '@12-apps/ui/provider';
import * as React from 'react';
import { SafeAreaView, ScrollView, StyleSheet } from 'react-native';

import { Gallery } from './Gallery';

/**
 * The harness app: one provider, one scrolling gallery of every ported
 * component in every state a story exercises, each under a stable test id.
 * Playwright reads the web export of this screen; the android export is read
 * as a bundle. There is no navigation and no state on purpose — what is under
 * test is the package, not an app.
 */
export function App(): React.JSX.Element {
  return (
    <UiProvider theme={{ mode: 'light' }}>
      <SafeAreaView style={styles.root} testID="app-root">
        <ScrollView contentContainerStyle={styles.content}>
          <Gallery />
        </ScrollView>
      </SafeAreaView>
    </UiProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 24 },
});
