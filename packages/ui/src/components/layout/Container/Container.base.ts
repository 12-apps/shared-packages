import type React from 'react';

/**
 * THE CONTRACT BOTH `Container` RENDERERS HONOUR — and nothing else.
 *
 * No MUI and no react-native here, on purpose: this file ships in both
 * declaration outputs (`dist/types` and `dist/types-native`), and a native
 * consumer has no `@mui/material` to resolve a type import against. The web
 * adds MUI `Container`'s own props in `Container.types.ts`; the native side
 * adds a `View`'s in `Container.types.native.ts`.
 */
export type ContainerMaxWidth = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | false;
export type ContainerVariant = 'default' | 'fluid' | 'centered' | 'padded';
export type ContainerPadding = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ContainerBaseProps {
  children: React.ReactNode;
  /**
   * The widest the content column gets, as one of MUI's breakpoints — see
   * `CONTAINER_MAX_WIDTHS`. `false` removes the limit. Any other string is
   * read as `lg`, as the web has always done.
   */
  maxWidth?: ContainerMaxWidth | string;
  /** `fluid` drops the limit, `centered` centres the content in the viewport, `padded` is a main content area. */
  variant?: ContainerVariant;
  /** The inset on every side, on the spacing scale — see `CONTAINER_PADDING_UNITS`. */
  padding?: ContainerPadding;
  /** Tighten the inset under MUI's `sm` breakpoint (600px). */
  responsive?: boolean;
  testID?: string;
  dataTestId?: string;
}
