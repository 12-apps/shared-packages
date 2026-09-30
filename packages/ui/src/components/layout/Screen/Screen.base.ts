import type { BoxBaseProps } from '../Box/Box.base';

/** Physical screen edges, independent of a native dependency. */
export type ScreenEdge = 'top' | 'right' | 'bottom' | 'left';
export const SCREEN_EDGES: readonly ScreenEdge[] = ['top', 'right', 'bottom', 'left'];

/** Padding and gap apply to the content, inside the selected safe-area edges. */
export interface ScreenBaseProps extends Pick<
  BoxBaseProps,
  'children' | 'p' | 'px' | 'py' | 'pt' | 'pr' | 'pb' | 'pl' | 'gap' | 'bg' | 'testID' | 'dataTestId'
> {
  /** Vertical scrolling; turn off when a child owns scrolling. Default true. */
  scroll?: boolean;
  /** Omit bottom when a navigator's tab bar already owns that inset. */
  safeAreaEdges?: readonly ScreenEdge[];
  /** Lift the native viewport above the soft keyboard. Default true. */
  keyboardAvoiding?: boolean;
  /** Native distance from the window top to the screen's parent, in dp. */
  keyboardVerticalOffset?: number;
}
