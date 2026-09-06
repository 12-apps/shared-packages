import * as React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  DIALOG_ACTIONS,
  DIALOG_CLOSE_BUTTON,
  DIALOG_CONTENT_PADDING_UNITS,
  DIALOG_HEADER_CHILDREN_PADDING_UNITS,
  DIALOG_TITLE,
  DIALOG_TITLED_BODY_PADDING_TOP_UNITS,
} from './Dialog.metrics';
import type {
  DialogActionsAlignment,
  DialogActionsProps,
  DialogContentProps,
  DialogHeaderProps,
} from './Dialog.types.native';
import { Icon } from '../../../icons/Icon.native';
import { childTestId, withoutTestIdProps, type TestIdProps } from '../../../platform/test-id';
import { renderTextChildren } from '../../../platform/text-children';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { muiTypeStyle } from '../../../tokens/mui-type';
import type { UiTheme } from '../../../tokens/theme';

/**
 * THE THREE SLOTS A DIALOG IS BUILT OUT OF, ON REACT NATIVE.
 *
 * The web overrides only padding, alignment and the dividers, so the rest of
 * the numbers are MUI's own and are restated in `Dialog.metrics.ts` rather than
 * re-invented.
 */

/**
 * Is there a title above this body?
 *
 * The web asks the DOM — `.MuiDialogTitle-root + &` — because only the CSS knows
 * which `DialogContent` actually FOLLOWS the title. React Native has no sibling
 * selector, so `Dialog` says so through context instead; the difference is that
 * a second `DialogContent` further down gets the tighter top padding too.
 */
export const DialogTitledContext = React.createContext(false);

/** The body text of a slot, in MUI's `body1`, so a bare string is not unstyled. */
export const dialogBodyTextStyle = (theme: UiTheme): TextStyle => ({
  ...muiTypeStyle(theme, 'body1'),
  color: theme.palette.text.primary,
});

/**
 * A slot's own test id.
 *
 * The web derives one from the DIALOG's `dataTestId` (`d` -> `d-content`) and
 * lets a raw `data-testid` spread straight over it, which is what the shared
 * stories address the slots by. `testID` is React Native's spelling of that
 * same raw id, so it wins too.
 */
const slotTestId = (props: TestIdProps, suffix: string): string =>
  props.testID ?? props['data-testid'] ?? childTestId(props, suffix, 'dialog');

/** MUI's dialog title: `h6`, in the body ink. */
export const dialogTitleStyle = (theme: UiTheme): TextStyle => ({
  ...muiTypeStyle(theme, 'h6'),
  color: theme.palette.text.primary,
});

/** The subtitle under it: `body2`, muted, one half-unit down. */
export const dialogSubtitleStyle = (theme: UiTheme): TextStyle => ({
  ...muiTypeStyle(theme, 'body2'),
  color: theme.palette.text.secondary,
  marginTop: theme.spacing(DIALOG_TITLE.subtitleGapUnits),
});

function CloseButton({ onPress, testID }: { onPress: () => void; testID: string }): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <Pressable
      role="button"
      aria-label="close"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.close,
        pressed ? { backgroundColor: theme.palette.action.hover } : null,
      ]}
    >
      <Icon name="Close" size={DIALOG_CLOSE_BUTTON.iconSize} color={theme.palette.text.secondary} />
    </Pressable>
  );
}

export function DialogHeader({
  children,
  title,
  subtitle,
  showCloseButton = true,
  onClose,
  ...others
}: DialogHeaderProps): React.JSX.Element {
  const theme = useUiTheme();
  const { style, ...viewProps } = withoutTestIdProps(others);

  if (children) {
    return (
      <View
        testID={slotTestId(others, 'header')}
        style={[
          {
            padding: theme.spacing(DIALOG_HEADER_CHILDREN_PADDING_UNITS),
            borderBottomWidth: 1,
            borderBottomColor: theme.palette.divider,
            borderStyle: 'solid',
          },
          style,
        ]}
        {...viewProps}
      >
        {renderTextChildren(children, dialogBodyTextStyle(theme))}
      </View>
    );
  }

  const paddingBottom = theme.spacing(
    subtitle ? DIALOG_TITLE.paddingBottomUnits.withSubtitle : DIALOG_TITLE.paddingBottomUnits.plain,
  );

  return (
    <View
      testID={slotTestId(others, 'title')}
      style={[styles.header, { paddingBottom }, style]}
      {...viewProps}
    >
      <View style={styles.headerText}>
        <RNText style={dialogTitleStyle(theme)}>{title}</RNText>
        {subtitle ? <RNText style={dialogSubtitleStyle(theme)}>{subtitle}</RNText> : null}
      </View>
      {showCloseButton && onClose ? (
        <CloseButton onPress={onClose} testID={childTestId(others, 'close', 'dialog')} />
      ) : null}
    </View>
  );
}

DialogHeader.displayName = 'DialogHeader';

export function DialogContent({
  children,
  dividers = false,
  dense = false,
  ...others
}: DialogContentProps): React.JSX.Element {
  const theme = useUiTheme();
  const titled = React.useContext(DialogTitledContext);
  const { style, ...viewProps } = withoutTestIdProps(others);
  const padding = theme.spacing(
    dense ? DIALOG_CONTENT_PADDING_UNITS.dense : DIALOG_CONTENT_PADDING_UNITS.normal,
  );
  const paddingTop = titled
    ? theme.spacing(DIALOG_TITLED_BODY_PADDING_TOP_UNITS)
    : padding;

  return (
    <ScrollView
      testID={slotTestId(others, 'content')}
      style={[
        styles.content,
        dividers
          ? {
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderStyle: 'solid',
              borderColor: theme.palette.divider,
            }
          : null,
        style,
      ]}
      contentContainerStyle={{ padding, paddingTop }}
      {...viewProps}
    >
      {renderTextChildren(children, dialogBodyTextStyle(theme))}
    </ScrollView>
  );
}

DialogContent.displayName = 'DialogContent';

const JUSTIFY: Record<DialogActionsAlignment, NonNullable<ViewStyle['justifyContent']>> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  'space-between': 'space-between',
};

export function DialogActions({
  children,
  alignment = 'right',
  spacing = DIALOG_ACTIONS.defaultSpacingUnits,
  ...others
}: DialogActionsProps): React.JSX.Element {
  const theme = useUiTheme();
  const { style, ...viewProps } = withoutTestIdProps(others);

  return (
    <View
      testID={slotTestId(others, 'actions')}
      style={[
        styles.actions,
        {
          padding: theme.spacing(DIALOG_ACTIONS.paddingUnits),
          justifyContent: JUSTIFY[alignment],
          gap: theme.spacing(spacing),
        },
        style,
      ]}
      {...viewProps}
    >
      {renderTextChildren(children, dialogBodyTextStyle(theme))}
    </View>
  );
}

DialogActions.displayName = 'DialogActions';

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexGrow: 0,
    flexShrink: 0,
    paddingTop: DIALOG_TITLE.padding.top,
    paddingHorizontal: DIALOG_TITLE.padding.horizontal,
  },
  headerText: {
    flexShrink: 1,
  },
  close: {
    padding: DIALOG_CLOSE_BUTTON.padding,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
});
