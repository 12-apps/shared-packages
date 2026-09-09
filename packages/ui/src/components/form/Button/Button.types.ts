import type { ButtonProps as MuiButtonProps } from '@mui/material/Button/index.js';
import type { OverridableComponent, OverrideProps } from '@mui/material/OverridableComponent/index.js';
import type * as React from 'react';

import type { ButtonBaseProps } from './Button.base';

export type { ButtonBaseProps, ButtonVariant } from './Button.base';

/**
 * Everything this Button adds, WITHOUT the element it renders as.
 *
 * `component` is deliberately omitted here and reintroduced by the type map
 * below: MUI models "render as something else" with a generic, and taking
 * `component?: React.ElementType` as a plain prop is exactly what threw the
 * target's own props away (12-70).
 */
export interface ButtonOwnProps
  extends ButtonBaseProps,
    Omit<MuiButtonProps, 'variant' | 'color' | 'size' | 'component' | keyof ButtonBaseProps> {
  /**
   * Click handler
   */
  onClick?: React.MouseEventHandler<HTMLElement>;

  /**
   * Focus handler
   */
  onFocus?: React.FocusEventHandler<HTMLElement>;

  /**
   * Blur handler
   */
  onBlur?: React.FocusEventHandler<HTMLElement>;
}

/**
 * What `Button` renders as, and what that brings with it.
 *
 * This is the shape MUI's `OverridableComponent` reads. Handing `component` a
 * router `Link` now also hands the call site that Link's OWN props — `to`,
 * `replace`, `state` — typed, which is the whole point of 12-70. Before this,
 * `component` was `React.ElementType` and `to` typechecked nowhere, so a host
 * that wanted a navigation painted as a button had to reach for a type
 * assertion or throw the `href` away.
 */
export interface ButtonTypeMap<
  AdditionalProps = object,
  RootComponent extends React.ElementType = 'button',
> {
  props: AdditionalProps & ButtonOwnProps;
  defaultComponent: RootComponent;
}

/**
 * The props of a Button rendered as `RootComponent` — `button` by default.
 *
 * Generic WITH defaults, so every existing `ButtonProps` (no arguments) keeps
 * meaning exactly what it meant before this change: the button-rendered case.
 */
export type ButtonProps<
  RootComponent extends React.ElementType = 'button',
  AdditionalProps = object,
> = OverrideProps<ButtonTypeMap<AdditionalProps, RootComponent>, RootComponent> & {
  component?: React.ElementType;
};

export type ButtonComponent = OverridableComponent<ButtonTypeMap>;
