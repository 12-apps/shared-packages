import * as React from 'react';
import {
  Image,
  StyleSheet,
  Text as RNText,
  View,
  type DimensionValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  CARD_ACTIONS,
  CARD_CONTENT_PADDING_UNITS,
  CARD_HEADER,
  CARD_HEADER_CHILDREN_PADDING_UNITS,
  CARD_MEDIA_HEIGHT,
} from './Card.metrics';
import type {
  CardActionsAlignment,
  CardActionsProps,
  CardContentProps,
  CardHeaderProps,
  CardMediaProps,
} from './Card.types.native';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { renderTextChildren } from '../../../platform/text-children';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';

/**
 * THE FOUR SLOTS A CARD IS BUILT OUT OF, ON REACT NATIVE.
 *
 * Each one is a `View` carrying the padding MUI's own `CardHeader`,
 * `CardContent`, `CardActions` and `CardMedia` declare in px — the web half
 * overrides only `padding` and `justify-content`, so the rest of the numbers
 * come from MUI and are restated in `Card.metrics.ts` rather than re-invented.
 */

/**
 * THE INK A CARD PUBLISHES TO ITS SLOTS.
 *
 * `Card.styles.ts` puts `color: primary.contrastText` on the gradient card
 * ITSELF and lets CSS inheritance carry it into the header and the body. React
 * Native inherits nothing across views, so the card publishes its ink here and
 * every slot reads it — which is the difference between a legible gradient card
 * and near-black text on indigo.
 *
 * `null` is "no card above me": a slot rendered on its own falls back to the
 * body ink, exactly as it would on the web.
 */
export const CardInkContext = React.createContext<string | null>(null);

/** The body text of a slot, in MUI's `body1`, so a bare string is not unstyled. */
const slotTextStyle = (theme: UiTheme, ink: string | null): TextStyle => ({
  ...muiTypeStyle(theme, 'body1'),
  color: ink ?? theme.palette.text.primary,
});

/** MUI's header title: `h5`, or `body2` when an avatar shares the row. */
export const cardTitleStyle = (
  theme: UiTheme,
  hasAvatar: boolean,
  ink: string | null = null,
): TextStyle => ({
  ...muiTypeStyle(theme, hasAvatar ? 'body2' : 'h5'),
  color: ink ?? theme.palette.text.primary,
});

/**
 * MUI's header subheader: `body1` (or `body2` beside an avatar), in the muted
 * ink — which does NOT follow the card's own ink, because MUI's `CardHeader`
 * pins the subheader to `textSecondary` explicitly rather than inheriting.
 */
export const cardSubtitleStyle = (theme: UiTheme, hasAvatar: boolean): TextStyle => ({
  ...muiTypeStyle(theme, hasAvatar ? 'body2' : 'body1'),
  color: theme.palette.text.secondary,
});

export function CardHeader({
  title,
  subtitle,
  action,
  avatar,
  children,
  ...others
}: CardHeaderProps): React.JSX.Element {
  const theme = useUiTheme();
  const ink = React.useContext(CardInkContext);
  const testID = resolveTestId(others, 'card-header');
  const { style, ...viewProps } = withoutTestIdProps(others);

  if (children) {
    return (
      <View
        testID={testID}
        style={[{ padding: theme.spacing(CARD_HEADER_CHILDREN_PADDING_UNITS) }, style]}
        {...viewProps}
      >
        {renderTextChildren(children, slotTextStyle(theme, ink))}
      </View>
    );
  }

  const hasAvatar = avatar != null;
  return (
    <View testID={testID} style={[styles.header, style]} {...viewProps}>
      {hasAvatar ? <View style={styles.headerAvatar}>{avatar}</View> : null}
      <View style={styles.headerContent}>
        {title != null ? (
          <RNText testID={childTestId(others, 'title', 'card')} style={cardTitleStyle(theme, hasAvatar, ink)}>
            {title}
          </RNText>
        ) : null}
        {subtitle != null ? (
          <RNText
            testID={childTestId(others, 'subtitle', 'card')}
            style={cardSubtitleStyle(theme, hasAvatar)}
          >
            {subtitle}
          </RNText>
        ) : null}
      </View>
      {action != null ? <View style={styles.headerAction}>{action}</View> : null}
    </View>
  );
}

CardHeader.displayName = 'CardHeader';

export function CardContent({
  children,
  dense = false,
  ...others
}: CardContentProps): React.JSX.Element {
  const theme = useUiTheme();
  const ink = React.useContext(CardInkContext);
  const testID = resolveTestId(others, 'card-content');
  const { style, ...viewProps } = withoutTestIdProps(others);
  const padding = theme.spacing(
    dense ? CARD_CONTENT_PADDING_UNITS.dense : CARD_CONTENT_PADDING_UNITS.normal,
  );

  return (
    <View testID={testID} style={[{ padding }, style]} {...viewProps}>
      {renderTextChildren(children, slotTextStyle(theme, ink))}
    </View>
  );
}

CardContent.displayName = 'CardContent';

const JUSTIFY: Record<CardActionsAlignment, NonNullable<ViewStyle['justifyContent']>> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  'space-between': 'space-between',
};

export function CardActions({
  children,
  disableSpacing = false,
  alignment = 'left',
  ...others
}: CardActionsProps): React.JSX.Element {
  const theme = useUiTheme();
  const ink = React.useContext(CardInkContext);
  const testID = resolveTestId(others, 'card-actions');
  const { style, ...viewProps } = withoutTestIdProps(others);

  return (
    <View
      testID={testID}
      style={[
        styles.actions,
        { justifyContent: JUSTIFY[alignment], gap: disableSpacing ? undefined : CARD_ACTIONS.gap },
        style,
      ]}
      {...viewProps}
    >
      {renderTextChildren(children, slotTextStyle(theme, ink))}
    </View>
  );
}

CardActions.displayName = 'CardActions';

/**
 * `height` accepts the web's spellings: a number, a numeric string (`"200"`, as
 * an `<img height>` takes) or a percentage.
 */
export function mediaHeight(height: number | string): DimensionValue {
  if (typeof height === 'number') return height;
  const parsed = Number(height);
  return Number.isFinite(parsed) ? parsed : (height as DimensionValue);
}

export function CardMedia({
  image,
  title,
  height = CARD_MEDIA_HEIGHT,
  children,
  ...others
}: CardMediaProps): React.JSX.Element {
  const testID = resolveTestId(others, 'card-media');
  const { style, ...viewProps } = withoutTestIdProps(others);

  return (
    <View
      testID={testID}
      style={[{ height: mediaHeight(height), width: '100%', overflow: 'hidden' }, style]}
      {...viewProps}
    >
      {image != null ? (
        <Image
          source={{ uri: image }}
          accessibilityLabel={title}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </View>
  );
}

CardMedia.displayName = 'CardMedia';

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: CARD_HEADER.padding,
  },
  headerAvatar: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    marginRight: CARD_HEADER.avatarGap,
  },
  headerContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 0,
  },
  headerAction: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    alignSelf: 'flex-start',
    marginTop: CARD_HEADER.action.marginTop,
    marginRight: CARD_HEADER.action.marginRight,
    marginBottom: CARD_HEADER.action.marginBottom,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: CARD_ACTIONS.padding,
  },
});
