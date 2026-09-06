import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { BadgeSize, BadgeVariant } from './Badge.base';
import { badgeMetrics, badgeTextStyle } from './Badge.look.native';
import { BADGE_CONTENT_GAP } from './Badge.metrics';
import { Icon } from '../../../icons/Icon.native';
import { renderTextChildren } from '../../../platform/text-children';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import type { ColorValue } from '../../../tokens/vocabulary';

export interface BadgeContentProps {
  variant: BadgeVariant;
  size: BadgeSize;
  color: ColorValue;
  icon?: React.ReactNode;
  closable: boolean;
  content: React.ReactNode;
  idFor: (suffix: string) => string;
  onClose: () => void;
}

/**
 * The badge's inner run: optional icon, the content itself, optional close
 * button — the same three slots and the same ids `BadgeContent.tsx` builds. A
 * dot badge shows none of it.
 */
export function BadgeContent({
  variant,
  size,
  color,
  icon,
  closable,
  content,
  idFor,
  onClose,
}: BadgeContentProps): React.JSX.Element | null {
  const theme = useUiTheme();
  if (variant === 'dot') return null;

  const metrics = badgeMetrics(size);
  const text = badgeTextStyle(theme, variant, size, color);
  const hasContent = content !== null && content !== undefined;
  if (!icon && !hasContent && !closable) return null;

  return (
    <View style={styles.run}>
      {icon ? (
        <View testID={idFor('icon')} style={{ height: metrics.iconSize, justifyContent: 'center' }}>
          {icon}
        </View>
      ) : null}
      {hasContent ? (
        <View testID={idFor('content')} style={styles.centre}>
          {renderTextChildren(content, text, 1)}
        </View>
      ) : null}
      {closable ? (
        <Pressable
          testID={idFor('close')}
          role="button"
          aria-label="close"
          onPress={onClose}
          style={styles.close}
        >
          <Icon name="Close" size={metrics.closeIconSize} color={text.color as string} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  run: { flexDirection: 'row', alignItems: 'center', gap: BADGE_CONTENT_GAP },
  centre: { alignItems: 'center', justifyContent: 'center' },
  /** MUI's close `IconButton` sits half a spacing unit clear of the label. */
  close: { marginLeft: 4, alignItems: 'center', justifyContent: 'center' },
});
