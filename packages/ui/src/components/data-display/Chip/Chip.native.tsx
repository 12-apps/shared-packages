import * as React from 'react';
import {
  Image,
  Pressable,
  Text as RNText,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { chipKeyAction, chipRole, isClickable, makeTestId } from './Chip.helpers';
import {
  chipAvatarStyle,
  chipContainerStyle,
  chipDeleteSlotStyle,
  chipLabelStyle,
  chipLeadingSlotStyle,
  chipMetrics,
  chipPaint,
  type ChipPaint,
} from './Chip.look.native';
import { chipMuiSize, type ChipSizeMetrics } from './Chip.metrics';
import type { ChipProps, ChipVariant } from './Chip.types.native';
import { Icon } from '../../../icons/Icon.native';
import { webKeyDown, type WebKeyHandler } from '../../../platform/web-keys';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

interface SlotArgs {
  metrics: ChipSizeMetrics;
  variant: ChipVariant;
}

/**
 * The leading slot. MUI restyles the icon ELEMENT through a class — 24px, or
 * 18px when small — which a native renderer cannot do to an arbitrary node, so
 * the slot carries the margins and the glyph keeps the size it was given.
 */
function LeadingSlot({
  metrics,
  variant,
  avatar,
  avatarSrc,
  icon,
  testID,
}: SlotArgs &
  Pick<ChipProps, 'avatar' | 'avatarSrc' | 'icon'> & { testID: string }): React.JSX.Element | null {
  if (avatar) {
    return <View style={chipLeadingSlotStyle(metrics, variant, 'avatar')}>{avatar}</View>;
  }
  if (avatarSrc) {
    return (
      <View style={chipLeadingSlotStyle(metrics, variant, 'avatar')}>
        <Image
          source={{ uri: avatarSrc }}
          style={chipAvatarStyle(metrics)}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }
  if (icon) {
    return (
      <View style={chipLeadingSlotStyle(metrics, variant, 'icon')} testID={testID}>
        {icon}
      </View>
    );
  }
  return null;
}

/** MUI's `deleteIcon`: the `Cancel` glyph, pressable, tucked under the label. */
function DeleteSlot({
  metrics,
  variant,
  color,
  onDelete,
  disabled,
  testID,
}: SlotArgs & {
  color: string;
  onDelete?: () => void;
  disabled?: boolean;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label="delete"
      disabled={disabled}
      onPress={onDelete}
      style={chipDeleteSlotStyle(metrics, variant)}
    >
      <Icon name="Cancel" size={metrics.deleteSize} color={color} />
    </Pressable>
  );
}

interface ChipBodyProps extends SlotArgs {
  paint: ChipPaint;
  label: string;
  avatar?: ChipProps['avatar'];
  avatarSrc?: string;
  icon?: ChipProps['icon'];
  deletable?: boolean;
  disabled?: boolean;
  onDelete?: () => void;
  idFor: (suffix: string) => string;
}

/** Everything inside the pill: the leading slot, the label, the delete button. */
function ChipBody({
  metrics,
  variant,
  paint,
  label,
  avatar,
  avatarSrc,
  icon,
  deletable,
  disabled,
  onDelete,
  idFor,
}: ChipBodyProps): React.JSX.Element {
  const theme = useUiTheme();
  return (
    <>
      <LeadingSlot
        metrics={metrics}
        variant={variant}
        avatar={avatar}
        avatarSrc={avatarSrc}
        icon={icon}
        testID={idFor('icon')}
      />
      <RNText
        testID={idFor('label')}
        numberOfLines={1}
        style={[chipLabelStyle(theme, metrics, variant), paint.label]}
      >
        {label}
      </RNText>
      {deletable ? (
        <DeleteSlot
          metrics={metrics}
          variant={variant}
          color={paint.deleteColor}
          onDelete={onDelete}
          disabled={disabled}
          testID={idFor('delete')}
        />
      ) : null}
    </>
  );
}

interface KeyDownArgs {
  role: 'option' | 'button' | undefined;
  disabled?: boolean;
  deletable?: boolean;
  selectable?: boolean;
  /** Whether the chip acts at all, under either handler spelling. */
  acts?: unknown;
  onClick?: () => void;
  onDelete?: () => void;
}

/**
 * The half of the chip's keyboard contract react-native-web does NOT already
 * cover. Its `Pressable` turns Enter into a press on any role, and Space into
 * one only on a `button` role (`isValidKeyPress`) — so a selectable chip, which
 * is an `option`, needs Space wiring here, and Delete/Backspace is never its.
 * On a device none of this is ever called.
 */
function makeChipKeyDown(args: KeyDownArgs): WebKeyHandler {
  return (event) => {
    const action = chipKeyAction(event.key, { ...args, onClick: args.acts });
    if (action === null) return;
    if (action === 'delete') {
      event.preventDefault();
      args.onDelete?.();
      return;
    }
    if (event.key === 'Enter' || args.role === 'button') return;
    event.preventDefault();
    args.onClick?.();
  };
}

/**
 * The native `Chip`: MUI's pill on a `Pressable`, reachable by keyboard only
 * when it acts — which is the same rule MUI applies through `clickable`.
 */
export const Chip = React.forwardRef<View, ChipProps>((props, ref) => {
  const {
    label,
    variant = 'filled',
    size = 'md',
    color = 'primary',
    avatarSrc,
    avatar,
    icon,
    selected,
    selectable,
    deletable,
    disabled,
    onClick,
    onPress,
    onDelete,
    dataTestId,
    testID,
    style,
    ...rest
  } = props;
  const theme = useUiTheme();
  const chipId = testID ?? dataTestId;
  const metrics = chipMetrics(chipMuiSize(size));
  const paint = chipPaint(theme, variant, color, Boolean(selected));
  const acts = onClick ?? onPress;
  const clickable = isClickable(disabled, acts, selectable);
  const role = chipRole(selectable, acts);

  const base: StyleProp<ViewStyle> = [
    chipContainerStyle(metrics, Boolean(disabled)),
    paint.container,
    style,
  ];

  const press = (event: GestureResponderEvent): void => {
    onClick?.();
    onPress?.(event);
  };

  return (
    <Pressable
      ref={ref}
      testID={chipId || 'chip'}
      role={role}
      aria-selected={selectable ? selected : undefined}
      disabled={disabled}
      // MUI makes only a clickable chip keyboard-reachable; react-native-web
      // would otherwise give every Pressable a tab stop.
      tabIndex={clickable ? 0 : -1}
      onPress={clickable ? press : undefined}
      {...webKeyDown(
        makeChipKeyDown({ role, disabled, deletable, selectable, acts, onClick, onDelete }),
      )}
      style={(state) => [base, state.pressed && clickable ? paint.pressed : null]}
      {...rest}
    >
      <ChipBody
        metrics={metrics}
        variant={variant}
        paint={paint}
        label={label}
        avatar={avatar}
        avatarSrc={avatarSrc}
        icon={icon}
        deletable={deletable}
        disabled={disabled}
        onDelete={onDelete}
        idFor={makeTestId(chipId)}
      />
    </Pressable>
  );
});

Chip.displayName = 'Chip';
