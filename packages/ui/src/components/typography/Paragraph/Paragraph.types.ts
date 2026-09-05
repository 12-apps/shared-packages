import type React from 'react';

import type { ParagraphBaseProps } from './Paragraph.base';

export type { ParagraphBaseProps, ParagraphVariant } from './Paragraph.base';

/** The web `Paragraph`: the shared contract, plus everything a `<p>` accepts. */
export interface ParagraphProps
  extends ParagraphBaseProps,
    Omit<React.HTMLAttributes<globalThis.HTMLParagraphElement>, 'color' | 'children'> {}
