import * as React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { SCREEN_EDGES } from './Screen.base';
import type { ScreenProps } from './Screen.types.native';
import { resolveBoxLayout, splitBoxProps } from '../Box/box-layout';
import { resolveTestId } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

const styles = StyleSheet.create({ fill: { flex: 1 }, content: { flexGrow: 1 } });

function keyboardBehavior(enabled: boolean): 'padding' | 'height' | undefined {
  if (!enabled) return undefined;
  return Platform.OS === 'ios' ? 'padding' : 'height';
}

/** Reuse a navigator's context, or own one outside the scrolling view. */
function ScreenBoundary({ children }: { children: React.ReactNode }): React.JSX.Element {
  const insets = React.useContext(SafeAreaInsetsContext);
  return insets === null
    ? <SafeAreaProvider style={styles.fill}>{children}</SafeAreaProvider>
    : <>{children}</>;
}

export const Screen = React.forwardRef<View, ScreenProps>(({
  children, scroll = true, safeAreaEdges = SCREEN_EDGES,
  keyboardAvoiding = true, keyboardVerticalOffset = 0, bg = 'default',
  style, contentContainerStyle, scrollViewProps, ...props
}, ref) => {
  const theme = useUiTheme();
  const { layout, rest } = splitBoxProps(props);
  const testID = resolveTestId(layout);
  const contentStyle = [styles.content, resolveBoxLayout({ ...layout, direction: 'column' }, theme), contentContainerStyle];
  return (
    <ScreenBoundary>
      <View ref={ref} testID={testID} {...rest} style={[styles.fill, resolveBoxLayout({ bg }, theme), style]}>
        <SafeAreaView edges={safeAreaEdges} style={styles.fill}>
          <KeyboardAvoidingView style={styles.fill} enabled={keyboardAvoiding}
            behavior={keyboardBehavior(keyboardAvoiding)} keyboardVerticalOffset={keyboardVerticalOffset}>
            {scroll ? (
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" {...scrollViewProps}
                testID={scrollViewProps?.testID ?? (testID ? `${testID}-viewport` : undefined)}
                style={styles.fill} contentContainerStyle={contentStyle}
                horizontal={false} automaticallyAdjustKeyboardInsets={false}
                automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
                {children}
              </ScrollView>
            ) : <View style={[styles.fill, contentStyle]}>{children}</View>}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </ScreenBoundary>
  );
});
Screen.displayName = 'Screen';
