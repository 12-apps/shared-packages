/**
 * THE CONTRACT BOTH RENDERERS HONOUR — and nothing else.
 *
 * This file imports no MUI and no react-native, on purpose: it is in BOTH
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against.
 */
export type SkeletonVariant = 'text' | 'circular' | 'rectangular' | 'wave';
export type SkeletonAnimation = 'pulse' | 'wave' | false;
export type SkeletonIntensity = 'low' | 'medium' | 'high';

/**
 * The contract both renderers honour. `className` and a CSS `style` are the
 * web's own and stay in `Skeleton.types.ts`; `style` on native is a
 * `ViewStyle` and is declared in `Skeleton.types.native.ts`.
 */
export interface SkeletonBaseProps {
  variant?: SkeletonVariant;
  animation?: SkeletonAnimation;
  width?: number | string;
  height?: number | string;
  count?: number;
  /** Between instances, in SPACING UNITS — `theme.spacing(n)` on both sides. */
  spacing?: number;
  borderRadius?: number | string;
  intensity?: SkeletonIntensity;
  glassmorphism?: boolean;
  shimmer?: boolean;
  /**
   * All three spellings of the same id: the web forwards `data-testid`, React
   * Native calls it `testID`, and `dataTestId` is the house name. See
   * `src/platform/test-id.ts`.
   */
  testID?: string;
  dataTestId?: string;
  'data-testid'?: string;
}
