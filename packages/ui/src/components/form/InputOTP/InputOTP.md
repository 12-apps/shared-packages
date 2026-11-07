# InputOTP Component

## Overview

The InputOTP component provides a specialized input field for one-time passwords and verification codes. It splits the input into individual digit boxes with automatic focus management, making it ideal for SMS verification codes, two-factor authentication, and other security-related inputs.

## Features

- **Multiple Input Variants**: Supports numeric-only, alphanumeric, and masked input modes
- **Auto-Focus Management**: Automatically advances focus to the next input as users type
- **Keyboard Navigation**: Full support for arrow keys, backspace, and tab navigation
- **Paste Support**: Users can paste complete codes for quick entry
- **Visual Effects**: Optional glass morphism and gradient effects for modern UI design
- **Flexible Sizing**: Five size variants from extra-small to extra-large
- **Theme Integration**: Six color themes matching your design system
- **Accessibility**: WCAG compliant with proper ARIA attributes and keyboard support
- **Responsive Design**: Adapts to different screen sizes and touch interfaces

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'numeric' \| 'alphanumeric' \| 'masked'` | `'numeric'` | Input validation type |
| `length` | `number` | `6` | Number of input digits |
| `value` | `string` | `''` | Current OTP value |
| `onChange` | `(value: string) => void` | - | Callback when value changes |
| `onComplete` | `(value: string) => void` | - | Callback when all digits are filled |
| `color` | `'primary' \| 'secondary' \| 'success' \| 'warning' \| 'danger' \| 'neutral'` | `'primary'` | Theme color |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Input size |
| `autoFocus` | `boolean` | `false` | Auto-focus first input on mount |
| `disabled` | `boolean` | `false` | Disable all inputs |
| `error` | `boolean` | `false` | Show error state |
| `glass` | `boolean` | `false` | Apply glass morphism effect |
| `gradient` | `boolean` | `false` | Apply gradient focus effect |
| `className` | `string` | - | Additional CSS classes |
| `aria-label` | `string` | - | Accessibility label (names the row, a `role="group"`) |

## Usage Examples

### Basic Usage

```tsx
import { InputOTP } from '@procurement/ui';

function VerificationForm() {
  const [code, setCode] = useState('');

  const handleComplete = (value: string) => {
    console.log('Verification code:', value);
    // Submit verification code
  };

  return (
    <InputOTP
      value={code}
      onChange={setCode}
      onComplete={handleComplete}
      autoFocus
    />
  );
}
```

### SMS Verification

```tsx
<InputOTP
  variant="numeric"
  length={4}
  color="primary"
  size="lg"
  autoFocus
  onComplete={(code) => verifySMSCode(code)}
  aria-label="Enter SMS verification code"
/>
```

### Two-Factor Authentication

```tsx
<InputOTP
  variant="numeric"
  length={6}
  color="success"
  glass
  onComplete={(code) => verify2FA(code)}
  aria-label="Enter 6-digit authenticator code"
/>
```

### Masked Security PIN

```tsx
<InputOTP
  variant="masked"
  length={4}
  color="warning"
  onComplete={(pin) => validatePIN(pin)}
  aria-label="Enter your security PIN"
/>
```

### Alphanumeric Code

```tsx
<InputOTP
  variant="alphanumeric"
  length={8}
  color="secondary"
  gradient
  onComplete={(code) => validateCode(code)}
  aria-label="Enter product activation code"
/>
```

### Error State Handling

```tsx
function CodeVerification() {
  const [code, setCode] = useState('');
  const [hasError, setHasError] = useState(false);

  const handleComplete = async (value: string) => {
    const isValid = await verifyCode(value);
    setHasError(!isValid);
    
    if (isValid) {
      // Proceed with success
    }
  };

  return (
    <>
      <InputOTP
        value={code}
        onChange={setCode}
        onComplete={handleComplete}
        error={hasError}
        color={hasError ? 'danger' : 'primary'}
      />
      {hasError && (
        <Typography color="error" variant="caption">
          Invalid verification code. Please try again.
        </Typography>
      )}
    </>
  );
}
```

## Keyboard Shortcuts

- **Arrow Left/Right**: Navigate between input fields
- **Backspace**: Delete current digit and move to previous field
- **Tab**: Move to next field
- **Shift+Tab**: Move to previous field
- **Delete**: Clear current field
- **Paste (Ctrl/Cmd+V)**: Paste complete code

## Accessibility

The InputOTP component is designed with accessibility in mind:

- **ARIA Labels**: The container is a `role="group"`, so the `aria-label` you pass names
  the slots together
- **Phone keypad** (`variant="numeric"`, FUT-4144): every slot `<input>` carries
  `inputmode="numeric"` and `pattern="[0-9]*"`, and the first slot
  `autocomplete="one-time-code"` so the phone can offer a code from an SMS. The
  `alphanumeric` and `masked` variants carry none of the three
- **Keyboard Navigation**: Full keyboard support for all interactions
- **Focus Management**: Clear focus indicators and logical tab order
- **Screen Reader Support**: Announces field positions and values
- **Error States**: Clear visual and semantic error indicators

### Best Practices

1. **Always provide an aria-label** describing what code is being entered
2. **Use appropriate variants** - numeric for numbers only, masked for PINs
3. **Provide clear error messages** when verification fails
4. **Consider mobile users** - use larger sizes on touch devices
5. **Test with keyboard navigation** to ensure accessibility

## Styling

The component supports various visual customizations:

### Size Variants
- `xs`: Extra small (compact forms)
- `sm`: Small (mobile interfaces)
- `md`: Medium (default desktop)
- `lg`: Large (prominent forms)
- `xl`: Extra large (accessibility focus)

### Color Themes
- `primary`: Main brand color
- `secondary`: Alternative brand color
- `success`: Positive feedback
- `warning`: Caution state
- `danger`: Error or critical state
- `neutral`: Subtle appearance

### Visual Effects
- **Glass Morphism**: Modern frosted glass effect
- **Gradient**: Dynamic gradient on focus
- **Combined**: Both effects for premium feel

## Performance Considerations

- **Controlled Component**: Use React.memo if parent re-renders frequently
- **Debounced Callbacks**: onChange fires on every keystroke, consider debouncing
- **Paste Handling**: Efficiently processes pasted content without blocking UI
- **Focus Management**: Uses refs to avoid unnecessary re-renders

## Common Use Cases

1. **SMS Verification**: 4-6 digit codes for phone number verification
2. **Email Verification**: 6-8 character codes for email confirmation
3. **Two-Factor Auth**: 6-digit TOTP codes from authenticator apps
4. **Security PINs**: 4-digit masked inputs for banking/security
5. **Product Keys**: 8-16 character alphanumeric activation codes
6. **Coupon Codes**: Variable length promotional codes
7. **Access Codes**: Meeting or session join codes

## Migration Guide

If migrating from a text input to InputOTP:

```tsx
// Before
<TextField
  value={code}
  onChange={(e) => setCode(e.target.value)}
  maxLength={6}
/>

// After
<InputOTP
  value={code}
  onChange={setCode}
  length={6}
  onComplete={handleVerification}
/>
```

## Testing

The InputOTP component supports automated testing through the `dataTestId` prop. When provided, it generates consistent test identifiers for both the container and individual input slots.

### Test ID Structure

- **Container**: Uses the `dataTestId` value directly
- **Individual Slots**: Appends `-slot-{index}` to the `dataTestId` value (zero-indexed)

### Usage in Tests

```tsx
// Component usage with testId
<InputOTP
  length={6}
  dataTestId="verification-code"
  onChange={handleChange}
  onComplete={handleComplete}
/>

// Test implementation examples

// Using Testing Library
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('should allow entering verification code', async () => {
  const handleComplete = jest.fn();

  render(
    <InputOTP
      length={6}
      dataTestId="verification-code"
      onComplete={handleComplete}
    />
  );

  // Access container
  const container = screen.getByTestId('verification-code');
  expect(container).toBeInTheDocument();

  // Access individual slots
  const firstSlot = screen.getByTestId('verification-code-slot-0');
  const secondSlot = screen.getByTestId('verification-code-slot-1');

  // Interact with slots
  await userEvent.type(firstSlot, '1');
  await userEvent.type(secondSlot, '2');

  expect(firstSlot).toHaveValue('1');
  expect(secondSlot).toHaveValue('2');
});

// Using Playwright
test('OTP input interaction', async ({ page }) => {
  await page.goto('/verification');

  // Access container
  const otpContainer = page.getByTestId('verification-code');
  await expect(otpContainer).toBeVisible();

  // Access and interact with individual slots
  await page.getByTestId('verification-code-slot-0').fill('1');
  await page.getByTestId('verification-code-slot-1').fill('2');
  await page.getByTestId('verification-code-slot-2').fill('3');
  await page.getByTestId('verification-code-slot-3').fill('4');
  await page.getByTestId('verification-code-slot-4').fill('5');
  await page.getByTestId('verification-code-slot-5').fill('6');

  // Verify completion
  await expect(page.getByText('Code verified')).toBeVisible();
});

// Using Cypress
describe('InputOTP', () => {
  it('should complete OTP entry', () => {
    cy.visit('/verification');

    // Verify container exists
    cy.getByTestId('verification-code').should('be.visible');

    // Enter OTP code
    cy.getByTestId('verification-code-slot-0').type('1');
    cy.getByTestId('verification-code-slot-1').type('2');
    cy.getByTestId('verification-code-slot-2').type('3');
    cy.getByTestId('verification-code-slot-3').type('4');
    cy.getByTestId('verification-code-slot-4').type('5');
    cy.getByTestId('verification-code-slot-5').type('6');

    // Verify all slots filled
    cy.getByTestId('verification-code-slot-0').should('have.value', '1');
    cy.getByTestId('verification-code-slot-5').should('have.value', '6');
  });
});
```

### Testing Best Practices

1. **Always provide dataTestId in test scenarios** to ensure stable selectors
2. **Use semantic test IDs** that describe the purpose (e.g., `sms-verification`, `2fa-code`)
3. **Test both container and individual slots** to verify complete functionality
4. **Verify slot indexing** is zero-based (first slot is `-slot-0`)
5. **Test dynamic lengths** by verifying the correct number of slots exist
6. **Test without dataTestId** to ensure component works when prop is omitted

### Testing Different Configurations

```tsx
// Short OTP (4 digits)
<InputOTP
  length={4}
  dataTestId="short-code"
/>
// Access slots: short-code-slot-0 through short-code-slot-3

// Long OTP (8 characters)
<InputOTP
  length={8}
  variant="alphanumeric"
  dataTestId="activation-key"
/>
// Access slots: activation-key-slot-0 through activation-key-slot-7

// Masked PIN
<InputOTP
  length={4}
  variant="masked"
  dataTestId="security-pin"
/>
// Access slots: security-pin-slot-0 through security-pin-slot-3
```

### Accessibility Testing

The component maintains accessibility compliance when using testIds:

```tsx
test('should be accessible with testIds', () => {
  const { container } = render(
    <InputOTP
      length={6}
      dataTestId="accessible-otp"
      aria-label="Enter verification code"
    />
  );

  // Run accessibility checks
  const results = await axe(container);
  expect(results).toHaveNoViolations();

  // Verify ARIA attributes are preserved
  const firstSlot = screen.getByTestId('accessible-otp-slot-0');
  expect(firstSlot).toHaveAttribute('maxLength', '1');
});
```

### Visual Regression Testing

When using visual regression tools like Chromatic or Percy:

```tsx
// Storybook story with testIds for visual testing
export const VisualTest: Story = {
  args: {
    length: 6,
    dataTestId: 'visual-otp',
    value: '123456',
  },
  parameters: {
    chromatic: { disableSnapshot: false },
  },
};
```

## React Native

`@12-apps/ui/form/InputOTP` resolves to `InputOTP.native.tsx` under Metro —
same import path, same props (`InputOTP.base.ts`), the same digit rules
(`InputOTP.core.ts`, shared with the web hook) and the same numbers
(`InputOTP.metrics.ts`). Native adds three props:

| Prop | Type | Description |
|------|------|-------------|
| `aria-label` | `string` | Names the row, a `role="group"`, so the boxes are announced as one code. |
| `labels` | `Partial<InputOTPLabels>` | `slot(position, length)` names each box; English ("Digit 1 of 6") when omitted; the pt-BR pack's family is `inputOtp` (`UI_LABELS['pt-BR'].inputOtp` from `@12-apps/ui/locales`), or the host passes its own. |
| `style` | `StyleProp<ViewStyle>` | Reaches the row, as `sx` does on the web. |

```tsx
import { InputOTP } from '@12-apps/ui/form/InputOTP';

<InputOTP
  length={6}
  variant="numeric"
  value={code}
  onChange={setCode}
  onComplete={join}
  error={refused}
  aria-label={copy.codeLabel}
  labels={{ slot: copy.codeSlot }}
/>
```

- **Typing** fills a box and moves to the next; **Backspace** in an empty box
  steps back; a refused character (a letter in `numeric`) leaves the box as it was.
- **A whole code** written into the first box — the keyboard's SMS suggestion
  (`oneTimeCode` on iOS, `sms-otp` on Android) or a paste — spreads across every
  box; a digit the phone left in front of an inserted code is dropped.
- **`onComplete`** fires when the last box is filled, with the code.
- **`error`** draws every box's border in the danger hue and keeps the digits,
  so the person corrects the code instead of retyping it.
- **Layout**: the row never wraps. Each box is a square of the field height
  that may shrink, so six `md` boxes fit one row at 320dp inside a padded sheet.

What it cannot draw (the glass blur, the gradient fill, hover) is listed in
[NATIVE-NOTES.md](./NATIVE-NOTES.md) and the ledger in `NATIVE.md`.

## Related Components

- `TextField`: For general text input needs
- `PasswordStrength`: For password creation with strength indicators
- `PhoneInput`: For international phone number input
- `Form`: For complete form management