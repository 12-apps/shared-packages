import { createInput } from '../Input.factory';
import type { InputComponent } from '../Input.factory';
import type { InputProps as GenericInputProps, InputVariant } from '../Input.types';
import { OutlinedTextFieldSlim } from './text-field-slim-outlined';

/**
 * The house variants MUI draws as `outlined`: `muiVariantFor` maps `glass` and
 * `gradient` onto an outline (`Input.metrics.ts`). `filled` and `underline`
 * need the inputs this entry exists to leave out, so they are a type error here
 * rather than a silent fallback.
 */
export type OutlinedInputVariant = Extract<InputVariant, 'outlined' | 'glass' | 'gradient'>;

export type InputProps = Omit<GenericInputProps, 'variant'> & { variant?: OutlinedInputVariant };

/**
 * `@12-apps/ui/form/Input/outlined` — the same `Input`, with the same props,
 * styles and DOM, built on a field that imports `OutlinedInput` and no other
 * MUI input (FUT-1054). For a control that only ever renders the outlined
 * family and sits where its bytes matter: a storefront header, a first screen.
 *
 * Not re-exported from `form/Input` or the `form` barrel: a second `Input`
 * there would collide. Reach it only through this subpath.
 */
export const Input = createInput(OutlinedTextFieldSlim) as InputComponent<InputProps>;

export type { InputSize } from '../Input.types';
