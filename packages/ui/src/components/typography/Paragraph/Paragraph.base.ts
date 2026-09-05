import type React from 'react';

import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

/**
 * THE CONTRACT BOTH `Paragraph` RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here, on purpose: this file ships in both
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against. The web
 * adds a `<p>`'s attributes in `Paragraph.types.ts`; the native side adds a
 * react-native `Text`'s props in `Paragraph.types.native.ts`.
 */
export type ParagraphVariant = 'default' | 'lead' | 'muted' | 'small';

export interface ParagraphBaseProps {
  /** `lead` is larger and looser, `muted` faded, `small` a step down — all at the default size. */
  variant?: ParagraphVariant;
  /** Ignored by `muted` and `small`, which always paint the secondary ink. */
  color?: ColorValue;
  size?: SizeValue;
  children: React.ReactNode;
  testID?: string;
  dataTestId?: string;
}
