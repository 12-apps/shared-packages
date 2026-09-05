import type React from 'react';

import type { TextBaseProps } from './Text.base';

export type { TextBaseProps, TextVariant, TextWeight } from './Text.base';

export interface TextProps
  extends TextBaseProps,
    Omit<React.HTMLAttributes<HTMLSpanElement>, 'color' | 'children'> {
  as?: keyof React.JSX.IntrinsicElements;
}
