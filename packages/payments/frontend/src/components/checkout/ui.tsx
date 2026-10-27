/**
 * The checkout's design-system seam (FUT-564, option 3: slot injection).
 *
 * The buyer screens in this folder ship BEHAVIOR and STRUCTURE — steps,
 * validation, polling, tokenization — but render their pixels through this
 * contract: a small set of primitive slots the host fills with its own design
 * system. Unfilled slots fall back to raw MUI (`defaultCheckoutComponents`),
 * which is why the package's peers are `@mui/material` + `@emotion/*` and
 * nothing else — a host with no component library still gets a working, plain
 * checkout, and a host with one (this repo fills these with `@12-apps/ui`) gets
 * its own look without the package ever importing it.
 *
 * Each slot's props are the SUBSET the checkout actually uses — deliberately
 * narrow so any design system can satisfy them with a thin (often identity)
 * mapping. The contract is documented for adopters in
 * `packages/payments/ADOPTING.md` §3.
 */
import { createContext, useContext, useMemo, type ChangeEvent, type ComponentType, type CSSProperties, type JSX, type lazy, type ReactNode } from 'react';

import { defaultCheckoutComponents } from './mui-defaults';

/** Typography. `variant`/`size`/`weight`/`color` are semantic, never raw CSS. */
export interface CheckoutTextProps {
  variant?: 'body' | 'heading' | 'caption' | 'code';
  size?: 'xs' | 'sm' | 'md';
  weight?: 'semibold' | 'bold';
  color?: 'primary' | 'secondary' | 'success' | 'danger';
  as?: 'p' | 'span' | 'h2';
  style?: CSSProperties;
  children: ReactNode;
  'data-testid'?: string;
}

/** The checkout's actions — `dataTestId` must land on the button element. */
export interface CheckoutButtonProps {
  variant?: 'solid' | 'outline' | 'text';
  color?: 'primary' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  onClick?: () => void;
  dataTestId?: string;
  children: ReactNode;
}

/** Text field. `data-testid` must land on the `<input>` itself (e2e fills it). */
export interface CheckoutInputProps {
  label?: string;
  /**
   * A stable id and `name` on the `<input>` (FUT-4105): what lets the browser's
   * form history and a password manager match the field again. Both are plain
   * `<input>` attributes `@12-apps/ui`'s `Input` forwards as they are.
   */
  id?: string;
  name?: string;
  type?: 'text' | 'email' | 'tel';
  inputMode?: 'numeric';
  variant?: 'outlined';
  size?: 'md';
  fullWidth?: boolean;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  value: string;
  error?: boolean;
  helperText?: string;
  endAdornment?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  /** A slot that does not forward it keeps the document field judged on every change (FUT-4106 needs it). */
  onFocus?: () => void;
  onBlur?: () => void;
  'data-testid'?: string;
}

export interface CheckoutCheckboxProps {
  checked: boolean;
  onChange?: (event: ChangeEvent<HTMLElement>, checked: boolean) => void;
  label?: string;
  'data-testid'?: string;
}

export interface CheckoutAlertProps {
  variant?: 'info' | 'warning' | 'danger';
  title?: string;
  description?: string;
  showIcon?: boolean;
  'data-testid'?: string;
}

export interface CheckoutLoadingStateProps {
  variant?: 'spinner';
  message?: string;
  size?: 'md';
  dataTestId?: string;
}

export interface CheckoutStepperStep {
  id: string;
  label: string;
}

export interface CheckoutStepperProps {
  steps: CheckoutStepperStep[];
  activeId: string;
  completed?: Set<string>;
  orientation?: 'horizontal';
  size?: 'sm';
  'data-testid'?: string;
}

export interface CheckoutRadioOption {
  value: string;
  label: string;
  description?: string;
}

export interface CheckoutRadioGroupProps {
  label?: string;
  value: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>, value: string) => void;
  options: CheckoutRadioOption[];
  dataTestId?: string;
}

/**
 * The bar that pins the primary CTA to the bottom of the viewport. In this
 * repo's storefront the host fills it with its `StickyActionBar` chrome; the
 * default is a plain sticky footer.
 */
export interface CheckoutActionBarProps {
  children: ReactNode;
  dataTestId?: string;
}

/**
 * How the checkout defers a part of a screen to a chunk of its own
 * (FUT-3711): React's `lazy` signature, `(factory) => Component`. The list
 * loads the CPF/wallet block above its rows and the computer's "Resumo do
 * pedido" column through it, so a checkout that never draws them never parses
 * them.
 *
 * A host whose deploys replace hashed chunks passes its stale-chunk-safe
 * loader here (one that reloads onto the current build when an old tab asks
 * for a chunk that is gone). Pass the SAME function every render: each loader
 * builds its deferred components once and keeps them, so a new function per
 * render re-suspends those parts every time. Unfilled, the default is
 * React's own `lazy`, which has no stale-chunk recovery.
 */
export type CheckoutLazy = typeof lazy;

/** Every primitive the buyer checkout renders through. */
export interface CheckoutComponents {
  Text: ComponentType<CheckoutTextProps>;
  Button: ComponentType<CheckoutButtonProps>;
  Input: ComponentType<CheckoutInputProps>;
  Checkbox: ComponentType<CheckoutCheckboxProps>;
  Alert: ComponentType<CheckoutAlertProps>;
  LoadingState: ComponentType<CheckoutLoadingStateProps>;
  Stepper: ComponentType<CheckoutStepperProps>;
  RadioGroup: ComponentType<CheckoutRadioGroupProps>;
  ActionBar: ComponentType<CheckoutActionBarProps>;
  /** Not a primitive but a loader — see `CheckoutLazy`. Absent ⇒ React's `lazy`. */
  lazy?: CheckoutLazy;
}

const CheckoutComponentsContext = createContext<CheckoutComponents>(defaultCheckoutComponents);

/**
 * Fills the checkout's component slots for everything rendered beneath it.
 * Partial on purpose: a host overrides only the slots its design system
 * covers and inherits the rest.
 *
 * Inherits from the NEAREST provider above, not from the raw-MUI defaults.
 * That distinction is the whole contract once these nest — and they do nest:
 * `createPaymentFlows` fills the slots once at the factory, and the
 * `CheckoutFlow` inside its mount opens a provider of its own. Merging over
 * the defaults there re-imposed raw MUI on a host that had already stated its
 * design system, silently, one level in. Merging over the inherited set makes
 * a nested provider ADD to what is above it, which is what "partial" has to
 * mean for the surface to agree with itself. The context's own default is
 * still `defaultCheckoutComponents`, so the outermost provider is unchanged:
 * an unfilled slot is raw MUI exactly as before.
 */
export function CheckoutComponentsProvider({
  components,
  children,
}: {
  components?: Partial<CheckoutComponents>;
  children: ReactNode;
}): JSX.Element {
  const inherited = useCheckoutComponents();
  const value = useMemo<CheckoutComponents>(
    () => ({ ...inherited, ...components }),
    [inherited, components],
  );
  return (
    <CheckoutComponentsContext.Provider value={value}>
      {children}
    </CheckoutComponentsContext.Provider>
  );
}

/** The filled slot set — raw MUI unless a provider above overrode a slot. */
export function useCheckoutComponents(): CheckoutComponents {
  return useContext(CheckoutComponentsContext);
}
