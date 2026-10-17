import * as React from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import type { TextStyle } from 'react-native';

import { BUTTON_SPINNER_SIZE } from './Button.metrics';
import { renderTextChildren } from '../../../platform/text-children';

/**
 * The native Button's loading state (FUT-3646): the label and icon stay laid
 * out under the spinner — so the button keeps its width and shape — and the
 * button keeps its name. Split from `Button.native.tsx` to keep that file
 * under the line ceiling.
 */

/**
 * The spinner over the label while loading, across the whole button; `role`
 * comes from react-native's ActivityIndicator. It used to REPLACE the label, so
 * a loading button had no accessible name (FUT-3646).
 */
export function Spinner({ color, testID }: { color: string; testID: string }): React.JSX.Element {
  return (
    <View style={styles.spinner}>
      <ActivityIndicator
        size={Platform.OS === 'ios' ? 'small' : BUTTON_SPINNER_SIZE}
        color={color}
        testID={testID}
        accessibilityLabel="loading"
      />
    </View>
  );
}

/**
 * The button's name while loading: its text label, said outright. The label
 * stays laid out (transparent) so the width holds, but a screen reader may skip
 * a view at opacity 0 — VoiceOver does — so the name cannot ride on it alone.
 * A caller's own `aria-label` still wins, being spread after this.
 */
export const loadingName = (loading: boolean | undefined, children: React.ReactNode): string | undefined =>
  loading && typeof children === 'string' ? children : undefined;

/** Laid out but unseen under the spinner while loading, so the width holds. */
export const hiddenWhile = (loading: boolean | undefined) => (loading ? styles.hidden : null);

/** The text label; while loading, kept laid out but unseen under the spinner. */
export function Label({
  loading,
  label,
  testID,
  children,
}: {
  loading: boolean | undefined;
  label: TextStyle;
  testID: string;
  children: React.ReactNode;
}): React.ReactNode {
  const text = renderTextChildren(children, label, 1);
  return loading ? (
    <View style={styles.hidden} testID={testID}>
      {text}
    </View>
  ) : (
    text
  );
}

const styles = StyleSheet.create({
  // The label and icon under the spinner: laid out, so the width holds, but unseen.
  hidden: {
    opacity: 0,
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
