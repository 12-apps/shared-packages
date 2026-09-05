import * as React from 'react';
import { StyleSheet, Text as RNText, View, type TextStyle, type ViewStyle } from 'react-native';

import {
  ERROR_ICON_BOX,
  ERROR_ICON_BOX_OPACITY,
  ERROR_ICON_SIZE,
  ERROR_MESSAGE_LINE_HEIGHT,
  ERROR_MESSAGE_MAX_WIDTH,
  ERROR_STATE_GAP_UNITS,
  ERROR_STATE_MIN_HEIGHT,
  ERROR_STATE_PADDING_UNITS,
  ERROR_TEXT_GAP_UNITS,
  RETRY_BUTTON,
  RETRY_MARGIN_TOP_UNITS,
  RETRY_MIN_WIDTH,
  errorStatePalette,
} from './ErrorState.metrics';
import type { ErrorStateProps, ErrorStateSeverity } from './ErrorState.types.native';
import { Icon } from '../../../icons/Icon.native';
import { webAria } from '../../../platform/aria';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { MUI_FONT_WEIGHT_MEDIUM, MUI_TYPE, muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';
import { Button } from '../../form/Button/Button.native';

const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `error-state-${suffix}`;

/** MUI's `h6` as an `h3`, medium weight, in the body ink — what the web `Typography` renders. */
export function titleStyle(theme: UiTheme): TextStyle {
  return {
    ...muiTypeStyle(theme, 'h6'),
    fontWeight: `${MUI_FONT_WEIGHT_MEDIUM}`,
    color: theme.palette.text.primary,
    textAlign: 'center',
  };
}

/** MUI's `body2` on a 1.6 line height, muted, wrapping at 400px. */
export function messageStyle(theme: UiTheme): TextStyle {
  return {
    ...muiTypeStyle(theme, 'body2'),
    lineHeight: MUI_TYPE.body2.fontSize * ERROR_MESSAGE_LINE_HEIGHT,
    color: theme.palette.text.secondary,
    maxWidth: ERROR_MESSAGE_MAX_WIDTH,
    textAlign: 'center',
  };
}

/** The 80px disc behind the glyph, in the severity's `light` shade. */
export function iconBoxStyle(theme: UiTheme, severity: ErrorStateSeverity): ViewStyle {
  return {
    width: ERROR_ICON_BOX,
    height: ERROR_ICON_BOX,
    borderRadius: ERROR_ICON_BOX / 2,
    backgroundColor: errorStatePalette(theme, severity).light,
    opacity: ERROR_ICON_BOX_OPACITY,
    alignItems: 'center',
    justifyContent: 'center',
  };
}

/** The web retry is MUI's medium outlined button; the house `Button` is sized to it here. */
export function retryStyle(theme: UiTheme): ViewStyle {
  return {
    marginTop: theme.spacing(RETRY_MARGIN_TOP_UNITS),
    minWidth: RETRY_MIN_WIDTH,
    paddingVertical: RETRY_BUTTON.paddingVertical,
    paddingHorizontal: RETRY_BUTTON.paddingHorizontal,
    borderRadius: theme.radius.md,
  };
}

function ErrorIcon({
  severity,
  icon,
  testId,
}: {
  severity: ErrorStateSeverity;
  icon?: React.ReactNode;
  testId: string;
}): React.JSX.Element {
  const theme = useUiTheme();
  const glyph = severity === 'error' ? 'ErrorOutline' : 'WarningAmber';
  return (
    <View testID={testId} style={iconBoxStyle(theme, severity)}>
      {icon || <Icon name={glyph} size={ERROR_ICON_SIZE} color={errorStatePalette(theme, severity).main} />}
    </View>
  );
}

function ErrorText({
  title,
  message,
  titleId,
  testId,
}: {
  title?: string;
  message: string;
  titleId: string;
  testId: (suffix: string) => string;
}): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <View style={[styles.text, { gap: theme.spacing(ERROR_TEXT_GAP_UNITS) }]}>
      {title ? (
        <RNText
          id={titleId}
          role="heading"
          {...webAria({ 'aria-level': 3 })}
          testID={testId('title')}
          style={titleStyle(theme)}
        >
          {title}
        </RNText>
      ) : null}
      <RNText id={`${titleId}-message`} testID={testId('message')} style={messageStyle(theme)}>
        {message}
      </RNText>
    </View>
  );
}

export const ErrorState: React.FC<ErrorStateProps> = React.memo(function ErrorState(props) {
  const {
    message,
    title,
    onRetry,
    retryLabel = 'Retry',
    severity = 'error',
    icon,
    style,
    ...others
  } = props;
  const theme = useUiTheme();
  const titleId = React.useId();
  const dataTestId = resolveTestId(others);
  const testId = makeTestId(dataTestId);
  const rest = withoutTestIdProps(others);

  return (
    <View
      role="alert"
      aria-labelledby={title ? titleId : undefined}
      {...webAria({ 'aria-describedby': `${titleId}-message` })}
      testID={dataTestId || 'error-state'}
      style={[
        styles.root,
        {
          padding: theme.spacing(ERROR_STATE_PADDING_UNITS),
          minHeight: ERROR_STATE_MIN_HEIGHT,
          gap: theme.spacing(ERROR_STATE_GAP_UNITS),
        },
        style,
      ]}
      {...rest}
    >
      <ErrorIcon severity={severity} icon={icon} testId={testId('icon')} />

      <ErrorText title={title} message={message} titleId={titleId} testId={testId} />

      {onRetry ? (
        <Button
          variant="outline"
          color={severity === 'error' ? 'danger' : 'warning'}
          size="sm"
          icon={<Icon name="Refresh" size={RETRY_BUTTON.iconSize} color={severity === 'error' ? 'danger' : 'warning'} />}
          onClick={onRetry}
          testID={testId('retry-button')}
          style={retryStyle(theme)}
        >
          {retryLabel}
        </Button>
      ) : null}
    </View>
  );
});

ErrorState.displayName = 'ErrorState';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    alignItems: 'center',
  },
});
