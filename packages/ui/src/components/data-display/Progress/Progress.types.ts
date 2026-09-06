import type { LinearProgressProps } from '@mui/material/LinearProgress/index.js';

import type { ProgressBaseProps } from './Progress.base';

export type { ProgressBaseProps, ProgressSize, ProgressVariant } from './Progress.base';

/** The web `Progress`: the shared contract, plus MUI's `LinearProgress` extras. */
export interface ProgressProps
  extends ProgressBaseProps,
    Omit<LinearProgressProps, 'variant' | 'color' | 'value'> {}
