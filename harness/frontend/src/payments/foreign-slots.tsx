/**
 * A FOREIGN design system for the checkout's slot contract (FUT-743).
 *
 * `@12-apps/payments-frontend` claims to be microfrontend-ready: behaviour and
 * structure in the package, pixels in the host, through a small set of
 * primitive slots. This repo's own filling of them is `@12-apps/ui`, which
 * proves nothing about a second host — the fallbacks and the one real filling
 * are both MUI, so an accidental MUI dependency in a screen would be invisible.
 *
 * So these are deliberately NOT MUI. Plain elements, plain CSS, no component
 * library at all — the shape a host with no design system would write. Every
 * one carries `data-ds="foreign"`, which is what lets a spec prove the same
 * flow rendered through a different system rather than merely rendered twice.
 *
 * The test ids are passed through UNCHANGED, because that is the contract: an
 * e2e selector must find the same hook whichever side of the seam draws the
 * pixels. A slot table that renamed them would make every existing spec a
 * spec about MUI.
 */
import type {
  CheckoutActionBarProps,
  CheckoutAlertProps,
  CheckoutButtonProps,
  CheckoutCheckboxProps,
  CheckoutComponents,
  CheckoutInputProps,
  CheckoutRadioGroupProps,
  CheckoutTextProps,
} from '@12-apps/payments-frontend';
import type { JSX } from 'react';

function ForeignText({ as = 'span', style, children, ...rest }: CheckoutTextProps): JSX.Element {
  const Tag = as;
  return (
    <Tag data-ds="foreign" data-testid={rest['data-testid']} style={style}>
      {children}
    </Tag>
  );
}

function ForeignButton({
  disabled,
  loading,
  onClick,
  dataTestId,
  children,
}: CheckoutButtonProps): JSX.Element {
  return (
    <button
      type="button"
      data-ds="foreign"
      data-testid={dataTestId}
      disabled={disabled || loading}
      onClick={onClick}
      style={{ padding: '8px 14px', border: '2px solid #333', borderRadius: 0, cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}

function ForeignInput({
  label,
  type = 'text',
  required,
  placeholder,
  value,
  error,
  helperText,
  onChange,
  onBlur,
  ...rest
}: CheckoutInputProps): JSX.Element {
  return (
    <label data-ds="foreign" style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 12 }}>{label}</span>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? 'true' : undefined}
        onChange={onChange}
        onBlur={onBlur}
        data-testid={rest['data-testid']}
        style={{ width: '100%', padding: 6, border: error ? '2px solid #b00' : '1px solid #666' }}
      />
      {helperText ? <small style={{ color: error ? '#b00' : '#666' }}>{helperText}</small> : null}
    </label>
  );
}

function ForeignCheckbox({ checked, onChange, label, ...rest }: CheckoutCheckboxProps): JSX.Element {
  return (
    <label data-ds="foreign" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event, event.target.checked)}
        data-testid={rest['data-testid']}
      />
      <span>{label}</span>
    </label>
  );
}

function ForeignAlert({ title, description, ...rest }: CheckoutAlertProps): JSX.Element {
  return (
    <div data-ds="foreign" data-testid={rest['data-testid']} style={{ border: '2px dashed #333', padding: 8 }}>
      <strong>{title}</strong>
      <div>{description}</div>
    </div>
  );
}

function ForeignRadioGroup({
  label,
  value,
  onChange,
  options,
  dataTestId,
}: CheckoutRadioGroupProps): JSX.Element {
  return (
    <fieldset data-ds="foreign" data-testid={dataTestId}>
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option.value} style={{ display: 'block' }}>
          <input
            type="radio"
            name={dataTestId ?? 'foreign-radio'}
            value={option.value}
            checked={value === option.value}
            onChange={(event) => onChange?.(event, option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

function ForeignActionBar({ children, dataTestId }: CheckoutActionBarProps): JSX.Element {
  return (
    <div data-ds="foreign" data-testid={dataTestId} style={{ borderTop: '2px solid #333', paddingTop: 8 }}>
      {children}
    </div>
  );
}

/**
 * Seven of the nine slots. `LoadingState` and `Stepper` are deliberately left
 * unfilled: "partial on purpose" is part of the contract, and a page that
 * filled everything would never notice a nested provider quietly resetting the
 * unfilled ones to raw MUI instead of inheriting them.
 */
export const foreignSlots: Partial<CheckoutComponents> = {
  Text: ForeignText,
  Button: ForeignButton,
  Input: ForeignInput,
  Checkbox: ForeignCheckbox,
  Alert: ForeignAlert,
  RadioGroup: ForeignRadioGroup,
  ActionBar: ForeignActionBar,
};
