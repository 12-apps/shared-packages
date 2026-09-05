import type { StackBaseProps } from './Stack.base';
import type { BoxProps } from '../Box/Box.types.native';

export type { StackBaseProps } from './Stack.base';

export type StackProps = StackBaseProps & Omit<BoxProps, keyof StackBaseProps>;
