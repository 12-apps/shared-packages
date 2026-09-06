import * as React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { hasSpacingSlot, withDialogDefaults } from './Dialog.helpers';
import { dialogBackdrop, dialogLook } from './Dialog.look.native';
import { DIALOG_BODY_PADDING_UNITS, DIALOG_PULSE } from './Dialog.metrics';
import type { DialogProps } from './Dialog.types.native';
import {
  DialogActions,
  DialogContent,
  DialogHeader,
  DialogTitledContext,
  dialogBodyTextStyle,
} from './DialogParts.native';
import { PulseRing } from '../../../platform/pulse-ring.native';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { renderTextChildren } from '../../../platform/text-children';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { UiTheme } from '../../../tokens/theme';

// The shared stories import all four names from `./Dialog`, which resolves here
// under Metro and in the native Storybook; the slots live in their own file to
// keep this one about the envelope, and are re-exported so that import works.
export { DialogActions, DialogContent, DialogHeader } from './DialogParts.native';

/**
 * The dialog body. Consumers that pass raw children (no `DialogContent`) would
 * render them flush against the paper edges — give them comfortable default
 * padding; `DialogContent`/`DialogActions` users keep managing their own.
 *
 * The web can also catch a slot passed through a COMPONENT boundary, with a
 * `:has()` selector that asks the DOM one step after React could. React Native
 * has no such selector, so only the element-type check runs here — see
 * NATIVE-NOTES.md.
 */
function bodyOf(theme: UiTheme, children: React.ReactNode, hasTitle: boolean): React.ReactNode {
  if (hasSpacingSlot(children, [DialogContent, DialogActions])) return children;
  const top = hasTitle ? DIALOG_BODY_PADDING_UNITS.topUnderTitle : DIALOG_BODY_PADDING_UNITS.top;
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing(DIALOG_BODY_PADDING_UNITS.horizontal),
        paddingBottom: theme.spacing(DIALOG_BODY_PADDING_UNITS.bottom),
        paddingTop: theme.spacing(top),
      }}
    >
      {renderTextChildren(children, dialogBodyTextStyle(theme))}
    </View>
  );
}

/**
 * Whether a `<DialogHeader>` arrived as a CHILD rather than through the `title`
 * prop.
 *
 * The web tightens a body under a title with
 * `.MuiDialogTitle-root + &.MuiDialogContent-root` — a CSS sibling selector, so
 * it fires however the title got there. Native reads a context instead, and the
 * context was set from the `title` prop alone, which is the composition nothing
 * uses: every story and `Dialog.md` write the header as a child, and those
 * bodies took the untitled 24px inset where the web gives them 12px.
 */
function hasHeaderChild(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === DialogHeader,
  );
}

export function Dialog(rawProps: DialogProps): React.JSX.Element {
  const {
    children,
    open,
    variant,
    size,
    title,
    description,
    showCloseButton,
    backdrop: _backdrop,
    persistent,
    glass,
    gradient: _gradient,
    glow,
    pulse,
    borderRadius,
    onClose,
    ...others
  } = withDialogDefaults(rawProps);

  const theme = useUiTheme();
  const look = dialogLook(theme, { variant, size, borderRadius, glass, glow, pulse });
  const testID = resolveTestId(others, 'dialog');
  const { style, ...modalProps } = withoutTestIdProps(others);

  // A persistent dialog refuses both routes out that are not a button: the
  // backdrop and Escape (which `Modal` routes through `onRequestClose`).
  const dismiss = persistent ? undefined : onClose;

  return (
    <Modal visible={open} transparent onRequestClose={dismiss} {...modalProps}>
      <View style={look.overlay}>
        <Pressable
          aria-hidden
          tabIndex={-1}
          testID={`${testID ?? 'dialog'}-backdrop`}
          onPress={dismiss}
          style={[StyleSheet.absoluteFill, dialogBackdrop(glass)]}
        />
        <View testID={testID} style={[look.paper, style]}>
          {pulse ? (
            <PulseRing
              color={theme.palette.primary.main}
              radius={look.radius}
              spread={DIALOG_PULSE.spread}
              durationMs={DIALOG_PULSE.durationMs}
              fadeAt={DIALOG_PULSE.fadeAt}
              opacity={DIALOG_PULSE.alpha}
              testID={`${testID ?? 'dialog'}-pulse`}
            />
          ) : null}
          <DialogTitledContext.Provider value={Boolean(title) || hasHeaderChild(children)}>
            {title ? (
              <DialogHeader
                title={title}
                subtitle={description}
                showCloseButton={showCloseButton}
                onClose={onClose}
                dataTestId={testID}
              />
            ) : null}
            {bodyOf(theme, children, Boolean(title))}
          </DialogTitledContext.Provider>
        </View>
      </View>
    </Modal>
  );
}

Dialog.displayName = 'Dialog';
