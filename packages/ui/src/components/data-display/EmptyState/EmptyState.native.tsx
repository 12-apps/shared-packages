import * as React from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { type ActionSpec, actionsOf, makeTestId } from './EmptyState.helpers';
import {
  ACTION_BUTTON,
  ACTION_MIN_WIDTH,
  ACTIONS_GAP_UNITS,
  ACTIONS_MARGIN_TOP_UNITS,
  ACTIONS_ROW_FROM,
  CONTENT_GAP_UNITS,
  DESCRIPTION_LINE_HEIGHT,
  DESCRIPTION_MAX_WIDTH,
  EMPTY_STATE_GAP_UNITS,
  EMPTY_STATE_MIN_HEIGHT,
  EMPTY_STATE_PADDING_UNITS,
  EXTERNAL_LINK_MARK,
  HELP_LINK_MARGIN_TOP_UNITS,
  illustrationMaxWidth,
  illustrationOpacity,
  MUI_CONTAINED_SHADOW,
  TITLE_MAX_WIDTH,
} from './EmptyState.metrics';
import type { EmptyStateHelpLink, EmptyStateProps, EmptyStateVariant } from './EmptyState.types.native';
import { Icon } from '../../../icons/Icon.native';
import { webAria } from '../../../platform/aria';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { alpha } from '../../../tokens/color';
import { MUI_FONT_WEIGHT_MEDIUM, MUI_TYPE, muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';
import { Button } from '../../form/Button/Button.native';

/** MUI's `h6` as an `h3`, medium weight, in the body ink, wrapping at 400px. */
export function titleStyle(theme: UiTheme): TextStyle {
  return {
    ...muiTypeStyle(theme, 'h6'),
    fontWeight: `${MUI_FONT_WEIGHT_MEDIUM}`,
    color: theme.palette.text.primary,
    maxWidth: TITLE_MAX_WIDTH,
    textAlign: 'center',
  };
}

/** MUI's `body2` on a 1.6 line height, muted, wrapping at 480px. */
export function descriptionStyle(theme: UiTheme): TextStyle {
  return {
    ...muiTypeStyle(theme, 'body2'),
    lineHeight: MUI_TYPE.body2.fontSize * DESCRIPTION_LINE_HEIGHT,
    color: theme.palette.text.secondary,
    maxWidth: DESCRIPTION_MAX_WIDTH,
    textAlign: 'center',
  };
}

/** The web `Link` inherits the page's `body1`; primary ink, no underline until hovered. */
export function helpLinkStyle(theme: UiTheme): TextStyle {
  return {
    ...muiTypeStyle(theme, 'body1'),
    color: theme.palette.primary.main,
    textDecorationLine: 'none',
    marginTop: theme.spacing(HELP_LINK_MARGIN_TOP_UNITS),
    textAlign: 'center',
  };
}

export function illustrationStyle(variant: EmptyStateVariant): ViewStyle {
  return {
    maxWidth: illustrationMaxWidth(variant),
    width: '100%',
    opacity: illustrationOpacity(variant),
    display: variant === 'minimal' ? 'none' : 'flex',
  };
}

/**
 * The web actions are MUI's medium contained/outlined buttons; the house
 * `Button` is sized to them here. The shadow needs the button's overflow
 * visible — a view clips its own shadow otherwise.
 */
export function actionStyle(theme: UiTheme, variant: ActionSpec['variant']): ViewStyle {
  const padding = ACTION_BUTTON[variant];
  return {
    minWidth: ACTION_MIN_WIDTH,
    borderRadius: theme.radius.md,
    paddingVertical: padding.paddingVertical,
    paddingHorizontal: padding.paddingHorizontal,
    ...(variant === 'contained'
      ? { boxShadow: MUI_CONTAINED_SHADOW, overflow: 'visible' }
      : { borderColor: alpha(theme.palette.primary.main, ACTION_BUTTON.outlinedBorderAlpha) }),
  };
}

/** MUI's `sm` breakpoint decides the action row's axis: a row from 600px up, a column below. */
export const actionsDirection = (windowWidth: number): 'row' | 'column' =>
  windowWidth >= ACTIONS_ROW_FROM ? 'row' : 'column';

/** react-native-web's anchor props for a `Text`, which React Native's `TextProps` do not declare. */
function anchorProps(href: string, external: boolean): object {
  if (Platform.OS !== 'web') return {};
  return { href, hrefAttrs: external ? { target: '_blank', rel: 'noopener noreferrer' } : undefined };
}

function ActionButton({ spec, testID }: { spec: ActionSpec; testID: string }): React.JSX.Element {
  const theme = useUiTheme();
  const contained = spec.variant === 'contained';
  const glyph = spec.icon ? (
    <Icon
      name={spec.icon}
      size={ACTION_BUTTON.iconSize}
      color={contained ? theme.palette.primary.contrastText : 'primary'}
    />
  ) : undefined;
  return (
    <Button
      variant={contained ? 'solid' : 'outline'}
      color="primary"
      size="sm"
      icon={glyph}
      onClick={spec.onClick}
      testID={testID}
      style={actionStyle(theme, spec.variant)}
    >
      {spec.label}
    </Button>
  );
}

function Actions({ specs, testId }: { specs: ActionSpec[]; testId: (suffix: string) => string }): React.JSX.Element {
  const theme = useUiTheme();
  const { width } = useWindowDimensions();
  return (
    <View
      style={[
        styles.actions,
        {
          flexDirection: actionsDirection(width),
          gap: theme.spacing(ACTIONS_GAP_UNITS),
          marginTop: theme.spacing(ACTIONS_MARGIN_TOP_UNITS),
        },
      ]}
    >
      {specs.map((spec) => (
        <ActionButton key={spec.key} spec={spec} testID={testId(spec.key)} />
      ))}
    </View>
  );
}

function HelpLink({ helpLink, testId }: { helpLink: EmptyStateHelpLink; testId: string }): React.JSX.Element {
  const theme = useUiTheme();
  const external = helpLink.external === true;
  // On the web the anchor navigates by itself; a device has no anchor and opens the URL.
  const open = Platform.OS === 'web' ? undefined : () => void Linking.openURL(helpLink.href);
  return (
    <RNText role="link" testID={testId} style={helpLinkStyle(theme)} onPress={open} {...anchorProps(helpLink.href, external)}>
      {helpLink.label}
      {external ? EXTERNAL_LINK_MARK : null}
    </RNText>
  );
}

interface ContentProps {
  title: string;
  description?: string;
  titleId: string;
  testId: (suffix: string) => string;
  actions: ActionSpec[];
  showActions: boolean;
  helpLink?: EmptyStateHelpLink;
}

function Content({ title, description, titleId, testId, actions, showActions, helpLink }: ContentProps): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <View style={[styles.content, { gap: theme.spacing(CONTENT_GAP_UNITS) }]}>
      <RNText id={titleId} role="heading" {...webAria({ 'aria-level': 3 })} testID={testId('title')} style={titleStyle(theme)}>
        {title}
      </RNText>

      {description ? (
        <RNText testID={testId('description')} style={descriptionStyle(theme)}>
          {description}
        </RNText>
      ) : null}

      {showActions ? <Actions specs={actions} testId={testId} /> : null}

      {helpLink ? <HelpLink helpLink={helpLink} testId={testId('help-link')} /> : null}
    </View>
  );
}

export const EmptyState: React.FC<EmptyStateProps> = React.memo(function EmptyState(props) {
  const {
    variant = 'default',
    title,
    description,
    illustration,
    helpLink,
    refreshLabel = 'Refresh',
    createLabel = 'Create New',
    primaryAction: _primary,
    secondaryAction: _secondary,
    onCreate: _onCreate,
    onRefresh: _onRefresh,
    style,
    ...others
  } = props;
  const theme = useUiTheme();
  const titleId = React.useId();
  const dataTestId = resolveTestId(others);
  const testId = makeTestId(dataTestId);
  const rest = withoutTestIdProps(others);

  const actions = actionsOf(props, refreshLabel, createLabel);
  // The `action` variant reserves the action row even when nothing fills it.
  const showActions = variant === 'action' || actions.length > 0;

  return (
    <View
      role="region"
      aria-labelledby={titleId}
      testID={dataTestId || 'empty-state'}
      style={[
        styles.root,
        {
          padding: theme.spacing(EMPTY_STATE_PADDING_UNITS),
          minHeight: EMPTY_STATE_MIN_HEIGHT,
          gap: theme.spacing(EMPTY_STATE_GAP_UNITS),
        },
        style,
      ]}
      {...rest}
    >
      {illustration ? (
        <View testID={testId('icon')} style={illustrationStyle(variant)}>
          {illustration}
        </View>
      ) : null}

      <Content
        title={title}
        description={description}
        titleId={titleId}
        testId={testId}
        actions={actions}
        showActions={showActions}
        helpLink={helpLink}
      />
    </View>
  );
});

EmptyState.displayName = 'EmptyState';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
  },
  actions: {
    alignItems: 'center',
  },
});
