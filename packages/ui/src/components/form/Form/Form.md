# Form Component

The Form component provides a flexible container for building forms with consistent spacing, layout, and validation patterns. It includes sub-components for form fields, labels, controls, and messages with built-in validation display and accessibility features.

## Usage

```tsx
import { Form, FormField, FormLabel, FormControl, FormMessage } from '@procurement/ui';

function MyForm() {
  return (
    <Form variant="vertical" maxWidth="md" spacing="md">
      <FormField name="email" label="Email" required>
        <Input type="email" placeholder="Enter your email" />
      </FormField>
      <FormField name="password" label="Password" required>
        <Input type="password" placeholder="Enter your password" />
      </FormField>
      <Button type="submit">Submit</Button>
    </Form>
  );
}
```

## Props

### Form Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'vertical' \| 'horizontal' \| 'inline' \| 'stepped'` | `'vertical'` | Form layout variant |
| maxWidth | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` | `'md'` | Maximum width constraint for the form |
| spacing | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | Spacing between form elements |
| onSubmit | `(event: FormEvent) => void` | - | Form submission handler |
| children | `ReactNode` | - | Form content |

### FormField Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| name | `string` | - | Field identifier |
| label | `string` | - | Field label text |
| required | `boolean` | `false` | Shows required indicator |
| error | `string` | - | Error message to display |
| helperText | `string` | - | Helper text to display |
| children | `ReactNode` | - | Field input component |

### FormLabel Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| required | `boolean` | `false` | Shows required asterisk |
| error | `boolean` | `false` | Error state styling |
| htmlFor | `string` | - | Associates with input |
| children | `ReactNode` | - | Label content |

### FormControl Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| error | `boolean` | `false` | Error state |
| fullWidth | `boolean` | `true` | Full width layout |
| children | `ReactNode` | - | Control content |

### FormMessage Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| error | `boolean` | `false` | Error state styling |
| children | `ReactNode` | - | Message content |

## Layout Variants

### Vertical Layout
Default layout with fields stacked vertically:
```tsx
<Form variant="vertical">
  <FormField name="field1" label="Field 1">
    <Input />
  </FormField>
  <FormField name="field2" label="Field 2">
    <Input />
  </FormField>
</Form>
```

### Horizontal Layout
Labels positioned horizontally beside inputs:
```tsx
<Form variant="horizontal">
  <FormField name="field1" label="Field 1">
    <Input />
  </FormField>
</Form>
```

### Inline Layout
All elements in a single row:
```tsx
<Form variant="inline">
  <Input placeholder="Search..." />
  <Button>Search</Button>
</Form>
```

## Row spacing

A label sits **4px** above its control, and exactly one thing puts it there:
`FormLabel`'s own `marginBottom` (`theme.spacing(0.5)`). `FormMessage` mirrors it
with the same 4px `marginTop` below the control, so a row reads 4 / control / 4.

`FormField` deliberately adds **nothing** to that. It used to: the wrapper was a
flex column with `gap: theme.spacing(1)`, and in a column a gap and a margin add
up — 8 + 4 = 12px, three times what the same package draws everywhere else.
`CepField`, `CategorySelect`, `CreatableSelect` and the `total-form` fields all
put a bare `FormLabel` straight inside a `FormControl`, which has no gap of its
own, so the label's margin is the whole of their spacing at 4px. `FormField` was
the only field in the package that disagreed.

Eight pixels a row is invisible on one field and decisive on six. Measured in
Chromium at 320x568 — the smallest supported viewport — a six-field address form
put its submit button 41px below the fold.

**There is no `spacing` prop, and that is the answer rather than an omission.**
A knob here would be a second place to state a decision that already has one, and
its default would have to be the 4px every other field draws — so the only thing
it would buy is the ability to disagree with them. A row that genuinely needs
more air gets it from the container: `Form`'s own `spacing` sets the distance
*between* fields, and a caller composing `FormControl` + `FormLabel` by hand can
space them however it likes.

`variant="horizontal"` keeps a `columnGap`, which is not the same job: there the
label sits beside the control, so a horizontal gap and a vertical margin are
orthogonal and nothing double-counts.

## Validation

Display validation errors and helper text:
```tsx
<FormField 
  name="email" 
  label="Email" 
  required 
  error="Please enter a valid email"
  helperText="We'll never share your email"
>
  <Input type="email" error />
</FormField>
```

## Accessibility

- Proper label association with inputs using `htmlFor`
- Required field indicators with ARIA attributes
- Error messages announced to screen readers
- Keyboard navigation support
- Focus management for form interactions

## Testing

The Form component and its sub-components support testing through the `dataTestId` prop. This enables reliable test automation and component verification.

### TestId Prop

All Form components accept a `dataTestId` prop:

```tsx
<Form dataTestId="login-form" variant="vertical">
  <FormField
    name="email"
    label="Email"
    required
    dataTestId="email-field"
  >
    <Input type="email" />
  </FormField>
</Form>
```

### Auto-generated TestIds

When you provide a `dataTestId` to `FormField`, it automatically generates testIds for its child elements:

- `{dataTestId}-label` - The field label element
- `{dataTestId}-control` - The field control wrapper
- `{dataTestId}-message` - Error or helper text element (when present)

Example:
```tsx
<FormField name="email" label="Email" dataTestId="email-field">
  <Input type="email" />
</FormField>

// Generates:
// - data-testid="email-field" (field wrapper)
// - data-testid="email-field-label" (label)
// - data-testid="email-field-control" (control wrapper)
// - data-testid="email-field-message" (if error or helperText provided)
```

### Testing Examples

**Basic Form Testing:**
```tsx
import { render, screen } from '@testing-library/react';
import { Form, FormField } from '@procurement/ui';

test('renders form with testIds', () => {
  render(
    <Form dataTestId="test-form">
      <FormField name="email" label="Email" dataTestId="email-field">
        <input type="email" />
      </FormField>
    </Form>
  );

  expect(screen.getByTestId('test-form')).toBeInTheDocument();
  expect(screen.getByTestId('email-field')).toBeInTheDocument();
  expect(screen.getByTestId('email-field-label')).toBeInTheDocument();
  expect(screen.getByTestId('email-field-control')).toBeInTheDocument();
});
```

**Testing Error Messages:**
```tsx
test('renders error message with testId', () => {
  render(
    <FormField
      name="email"
      label="Email"
      error="Invalid email"
      dataTestId="email-field"
    >
      <input type="email" />
    </FormField>
  );

  const errorMessage = screen.getByTestId('email-field-message');
  expect(errorMessage).toHaveTextContent('Invalid email');
});
```

**Testing Helper Text:**
```tsx
test('renders helper text with testId', () => {
  render(
    <FormField
      name="username"
      label="Username"
      helperText="Choose a unique username"
      dataTestId="username-field"
    >
      <input type="text" />
    </FormField>
  );

  const helperText = screen.getByTestId('username-field-message');
  expect(helperText).toHaveTextContent('Choose a unique username');
});
```

**Testing Individual Components:**
```tsx
import { FormLabel, FormControl, FormMessage } from '@procurement/ui';

test('FormLabel renders with testId', () => {
  render(<FormLabel dataTestId="custom-label">Label Text</FormLabel>);
  expect(screen.getByTestId('custom-label')).toBeInTheDocument();
});

test('FormControl renders with testId', () => {
  render(
    <FormControl dataTestId="custom-control">
      <input type="text" />
    </FormControl>
  );
  expect(screen.getByTestId('custom-control')).toBeInTheDocument();
});

test('FormMessage renders with testId', () => {
  render(<FormMessage dataTestId="custom-message">Message</FormMessage>);
  expect(screen.getByTestId('custom-message')).toBeInTheDocument();
});
```

### Accessibility Testing

Form components include proper ARIA attributes and roles:

```tsx
test('form has proper accessibility attributes', () => {
  render(
    <Form dataTestId="accessible-form">
      <FormField name="email" label="Email" required>
        <input type="email" aria-label="Email" aria-required="true" />
      </FormField>
    </Form>
  );

  const form = screen.getByTestId('accessible-form');
  expect(form).toHaveAttribute('role', 'form');
});
```

## Best Practices

1. Always provide labels for form fields
2. Use appropriate input types (email, tel, number, etc.)
3. Group related fields together
4. Provide clear error messages
5. Include helper text for complex fields
6. Make forms responsive for mobile devices
7. Implement proper validation feedback
8. Consider progressive disclosure for complex forms
9. Use `dataTestId` props for all form elements in automated tests
10. Leverage auto-generated testIds for comprehensive form testing

## Examples

### Login Form
```tsx
<Form variant="vertical" maxWidth="sm">
  <FormField name="email" label="Email" required>
    <Input type="email" />
  </FormField>
  <FormField name="password" label="Password" required>
    <Input type="password" />
  </FormField>
  <FormField name="remember">
    <Checkbox label="Remember me" />
  </FormField>
  <Button type="submit" fullWidth>Login</Button>
</Form>
```

### Contact Form
```tsx
<Form variant="vertical" maxWidth="md">
  <Stack direction="row" spacing={2}>
    <FormField name="firstName" label="First Name" required>
      <Input />
    </FormField>
    <FormField name="lastName" label="Last Name" required>
      <Input />
    </FormField>
  </Stack>
  <FormField name="email" label="Email" required>
    <Input type="email" />
  </FormField>
  <FormField name="message" label="Message" required>
    <Textarea rows={4} />
  </FormField>
  <Button type="submit">Send Message</Button>
</Form>
```