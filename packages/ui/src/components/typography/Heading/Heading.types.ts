import type React from 'react';

import type { HeadingBaseProps } from './Heading.base';

/**
 * Re-exported, not re-declared. `HeadingLevel` was spelled out here AND (as
 * `Level`) inside `Heading.styles.ts`, so the union and the metrics table were
 * two lists nothing kept in step — the failure `tokens/scales.ts` was written
 * to end.
 */
export type { HeadingBaseProps, HeadingLevel, HeadingWeight } from './Heading.base';

/** The web `Heading`: the shared contract, plus everything an `<h1>`…`<h6>` accepts. */
export interface HeadingProps
  extends HeadingBaseProps,
    Omit<React.HTMLAttributes<globalThis.HTMLHeadingElement>, 'color' | 'children'> {}
