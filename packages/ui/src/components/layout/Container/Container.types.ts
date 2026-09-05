import type { ContainerProps as MuiContainerProps } from '@mui/material/Container/index.js';

import type { ContainerBaseProps } from './Container.base';

export type { ContainerBaseProps, ContainerMaxWidth, ContainerPadding, ContainerVariant } from './Container.base';

/** The web `Container`: the shared contract, plus whatever MUI's `Container` accepts that it does not already name. */
export interface ContainerProps
  extends ContainerBaseProps,
    Omit<MuiContainerProps, keyof ContainerBaseProps> {}
