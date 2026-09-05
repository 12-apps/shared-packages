import * as React from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { type LoadingStateTestIds, makeTestIds, resolveLoadingStateProps } from './LoadingState.helpers';
import {
  IOS_LARGE_SPINNER_FROM,
  MESSAGE_TYPE,
  SKELETON_FULL_ROW_WIDTH,
  SKELETON_LAST_ROW_WIDTH,
  SKELETON_MESSAGE_MARGIN_TOP_UNITS,
  SKELETON_PADDING_UNITS,
  SKELETON_RADIUS,
  SKELETON_ROW_GAP_UNITS,
  SKELETON_ROW_HEIGHT,
  SKELETON_TINT_ALPHA,
  SPINNER_GAP_UNITS,
  SPINNER_MIN_HEIGHT,
  SPINNER_PADDING_UNITS,
  SPINNER_SIZES,
} from './LoadingState.metrics';
import type { LoadingStateProps, LoadingStateSize } from './LoadingState.types.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { alpha } from '../../../tokens/color';
import { muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';

/** The message's type: MUI's `body2`/`body1`/`h6` per size, in the muted ink, as the web's `Typography` sets it. */
export function messageStyle(theme: UiTheme, size: LoadingStateSize): TextStyle {
  return { ...muiTypeStyle(theme, MESSAGE_TYPE[size]), color: theme.palette.text.secondary };
}

/** The skeleton rows' tint: the house `Skeleton`'s `medium` intensity. */
export const skeletonTint = (theme: UiTheme): string =>
  alpha(theme.palette.text.primary, SKELETON_TINT_ALPHA);

/** iOS has two spinner sizes; everything else takes the px. */
function spinnerSize(px: number): number | 'small' | 'large' {
  if (Platform.OS !== 'ios') return px;
  return px >= IOS_LARGE_SPINNER_FROM ? 'large' : 'small';
}

interface ViewArgs {
  message?: string;
  size: LoadingStateSize;
  skeletonRows: number;
  testIds: LoadingStateTestIds;
  style?: StyleProp<ViewStyle>;
  rest: Omit<LoadingStateProps, keyof ViewArgs | 'variant' | 'testID' | 'dataTestId'>;
}

function LoadingMessage({
  message,
  size,
  testIds,
  style,
}: Pick<ViewArgs, 'message' | 'size' | 'testIds'> & { style?: TextStyle }): React.JSX.Element | null {
  const theme = useUiTheme();
  if (!message) return null;
  return (
    <RNText style={[messageStyle(theme, size), style]} testID={testIds.named('message')}>
      {message}
    </RNText>
  );
}

function SkeletonRows({ size, skeletonRows, testIds }: Pick<ViewArgs, 'size' | 'skeletonRows' | 'testIds'>): React.JSX.Element {
  const theme = useUiTheme();
  const tint = skeletonTint(theme);
  return (
    <View style={{ gap: theme.spacing(SKELETON_ROW_GAP_UNITS) }}>
      {Array.from({ length: skeletonRows }, (_, index) => (
        <View
          key={`skeleton-row-${index}`}
          aria-hidden
          testID={testIds.optional(`skeleton-${index}`)}
          style={{
            height: SKELETON_ROW_HEIGHT[size],
            // The last row is short, so the block reads as a paragraph of text.
            width: index === skeletonRows - 1 ? SKELETON_LAST_ROW_WIDTH : SKELETON_FULL_ROW_WIDTH,
            borderRadius: SKELETON_RADIUS,
            backgroundColor: tint,
          }}
        />
      ))}
    </View>
  );
}

function SkeletonView({ message, size, skeletonRows, testIds, style, rest }: ViewArgs): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <View
      role="status"
      aria-busy
      aria-label={message || 'Loading content'}
      testID={testIds.base}
      style={[styles.skeleton, { padding: theme.spacing(SKELETON_PADDING_UNITS) }, style]}
      {...rest}
    >
      <SkeletonRows size={size} skeletonRows={skeletonRows} testIds={testIds} />
      <LoadingMessage
        message={message}
        size={size}
        testIds={testIds}
        style={{ marginTop: theme.spacing(SKELETON_MESSAGE_MARGIN_TOP_UNITS), textAlign: 'center' }}
      />
    </View>
  );
}

function SpinnerView({ message, size, testIds, style, rest }: ViewArgs): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <View
      role="status"
      aria-busy
      aria-label={message || 'Loading'}
      testID={testIds.base}
      style={[
        styles.spinner,
        {
          padding: theme.spacing(SPINNER_PADDING_UNITS),
          minHeight: SPINNER_MIN_HEIGHT,
          gap: theme.spacing(SPINNER_GAP_UNITS),
        },
        style,
      ]}
      {...rest}
    >
      <ActivityIndicator
        size={spinnerSize(SPINNER_SIZES[size])}
        color={theme.palette.primary.main}
        testID={testIds.named('spinner')}
      />
      <LoadingMessage message={message} size={size} testIds={testIds} />
    </View>
  );
}

export const LoadingState: React.FC<LoadingStateProps> = React.memo(function LoadingState(rawProps) {
  const resolved = resolveLoadingStateProps(rawProps);
  const { variant, message, size, skeletonRows, style, ...others } = resolved;
  const args: ViewArgs = {
    message,
    size,
    skeletonRows,
    style,
    testIds: makeTestIds(resolveTestId(others)),
    rest: withoutTestIdProps(others),
  };

  return variant === 'skeleton' ? <SkeletonView {...args} /> : <SpinnerView {...args} />;
});

LoadingState.displayName = 'LoadingState';

const styles = StyleSheet.create({
  skeleton: {
    width: '100%',
  },
  spinner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
