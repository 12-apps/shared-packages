import Button from '@mui/material/Button/index.js';
import TextField from '@mui/material/TextField/index.js';
import Typography from '@mui/material/Typography/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor,within } from 'storybook/test';

import { Form, FormField } from './Form';

const meta: Meta<typeof Form> = {
  title: 'Form/Form/Tests',
  component: Form,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
    docs: {
      description: {
        component:
          'Comprehensive test stories for Form component covering interaction, accessibility, visual, performance, and edge case testing.',
      },
    },
  },
  tags: ['autodocs', 'test', 'component:Form'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Test 1: Basic Interaction Test
export const BasicInteraction: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    onSubmit: fn(),
    dataTestId: 'login-form',
    children: (
      <>
        <FormField name="email" label="Email" required dataTestId="email-field">
          <TextField
            type="email"
            placeholder="Enter your email"
            fullWidth
            defaultValue=""
            inputProps={{ 'data-testid': 'email-input' }}
          />
        </FormField>
        <FormField name="password" label="Password" required dataTestId="password-field">
          <TextField
            type="password"
            placeholder="Enter your password"
            fullWidth
            defaultValue=""
            inputProps={{ 'data-testid': 'password-input' }}
          />
        </FormField>
        <Button variant="contained" type="submit" fullWidth data-testid="submit-button">
          Submit
        </Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify form testId
    const form = canvas.getByTestId('login-form');
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute('role', 'form');

    // Verify FormField testIds
    const emailField = canvas.getByTestId('email-field');
    const passwordField = canvas.getByTestId('password-field');
    expect(emailField).toBeInTheDocument();
    expect(passwordField).toBeInTheDocument();

    // Verify nested testIds (label, control)
    const emailLabel = canvas.getByTestId('email-field-label');
    const emailControl = canvas.getByTestId('email-field-control');
    const passwordLabel = canvas.getByTestId('password-field-label');
    const passwordControl = canvas.getByTestId('password-field-control');

    expect(emailLabel).toBeInTheDocument();
    expect(emailControl).toBeInTheDocument();
    expect(passwordLabel).toBeInTheDocument();
    expect(passwordControl).toBeInTheDocument();

    // Find form elements - use the input elements directly
    const emailInput = canvas.getByTestId('email-input') as HTMLInputElement;
    const passwordInput = canvas.getByTestId('password-input') as HTMLInputElement;
    const submitButton = canvas.getByTestId('submit-button');

    expect(emailInput).toBeInTheDocument();
    expect(passwordInput).toBeInTheDocument();
    expect(submitButton).toBeInTheDocument();

    // Clear inputs first
    await userEvent.clear(emailInput);
    await userEvent.clear(passwordInput);

    // Test basic interactions
    await userEvent.type(emailInput, 'test@example.com');
    await userEvent.type(passwordInput, 'password123');

    // Wait for the values to be updated
    await waitFor(() => {
      expect(emailInput).toHaveValue('test@example.com');
      expect(passwordInput).toHaveValue('password123');
    });
  },
};

// Test 2: Keyboard Navigation Test
export const KeyboardNavigation: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    children: (
      <>
        <FormField name="field1" label="First Field" required>
          <TextField
            placeholder="First field"
            fullWidth
            inputProps={{ 'data-testid': 'first-field' }}
          />
        </FormField>
        <FormField name="field2" label="Second Field" required>
          <TextField
            placeholder="Second field"
            fullWidth
            inputProps={{ 'data-testid': 'second-field' }}
          />
        </FormField>
        <Button variant="contained" type="submit" data-testid="submit-btn" fullWidth>
          Submit
        </Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const firstField = canvas.getByTestId('first-field');
    const secondField = canvas.getByTestId('second-field');
    const submitButton = canvas.getByTestId('submit-btn');

    // Focus first field
    await userEvent.click(firstField);
    await waitFor(() => {
      expect(firstField).toHaveFocus();
    });

    // Tab to second field
    await userEvent.tab();
    await waitFor(() => {
      expect(secondField).toHaveFocus();
    });

    // Tab to submit button
    await userEvent.tab();
    await waitFor(() => {
      expect(submitButton).toHaveFocus();
    });
  },
};

// Test 3: Responsive Design Test
export const ResponsiveDesign: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'full',
    spacing: 'md',
    children: (
      <>
        <Typography variant="h6" mb={2}>
          Responsive Form Layout
        </Typography>
        <div data-testid="responsive-container">
          <FormField name="firstName" label="First Name" required>
            <TextField
              placeholder="First name"
              fullWidth
              inputProps={{ 'data-testid': 'first-name' }}
            />
          </FormField>
          <FormField name="lastName" label="Last Name" required>
            <TextField
              placeholder="Last name"
              fullWidth
              inputProps={{ 'data-testid': 'last-name' }}
            />
          </FormField>
        </div>
      </>
    ),
  },
  parameters: {
    viewport: {
      viewports: {
        mobile: {
          name: 'Mobile',
          styles: { width: '375px', height: '667px' },
          type: 'mobile',
        },
        tablet: {
          name: 'Tablet',
          styles: { width: '768px', height: '1024px' },
          type: 'tablet',
        },
        desktop: {
          name: 'Desktop',
          styles: { width: '1920px', height: '1080px' },
          type: 'desktop',
        },
      },
      defaultViewport: 'mobile',
    },
    chromatic: {
      viewports: [375, 768, 1920],
      delay: 300,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const container = canvas.getByTestId('responsive-container');
    expect(container).toBeInTheDocument();

    const firstName = canvas.getByTestId('first-name');
    const lastName = canvas.getByTestId('last-name');

    expect(firstName).toBeInTheDocument();
    expect(lastName).toBeInTheDocument();
  },
};

// Test 4: Visual States Test
export const VisualStates: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    children: (
      <>
        <Typography variant="h6" mb={2} data-testid="form-title">
          Visual States Demo
        </Typography>

        <FormField name="normal" label="Normal State">
          <TextField
            placeholder="Normal input"
            fullWidth
            inputProps={{ 'data-testid': 'normal-input' }}
          />
        </FormField>

        <FormField name="required" label="Required Field" required>
          <TextField
            placeholder="Required input"
            fullWidth
            inputProps={{ 'data-testid': 'required-input' }}
          />
        </FormField>

        <Button variant="contained" data-testid="submit-button" fullWidth>
          Submit
        </Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const title = canvas.getByTestId('form-title');
    expect(title).toBeInTheDocument();
    expect(title).toBeVisible();

    const normalInput = canvas.getByTestId('normal-input');
    expect(normalInput).toBeInTheDocument();

    const submitButton = canvas.getByTestId('submit-button');
    expect(submitButton).toBeInTheDocument();
  },
};

// Test 5: Edge Cases Test
export const EdgeCases: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    children: (
      <>
        <Typography variant="h6" mb={2}>
          Edge Cases Testing
        </Typography>

        <FormField name="empty" label="Empty Field">
          <div
            data-testid="empty-field"
            style={{ minHeight: '40px', border: '1px dashed #ccc', padding: '8px' }}
          >
            Empty field placeholder
          </div>
        </FormField>

        <FormField name="longText" label="Very Long Label That Should Handle Overflow Gracefully">
          <TextField
            placeholder="Long text input"
            fullWidth
            inputProps={{ 'data-testid': 'long-text-input' }}
          />
        </FormField>

        <Button variant="contained" type="submit" fullWidth data-testid="edge-submit">
          Submit Edge Cases
        </Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const emptyField = canvas.getByTestId('empty-field');
    expect(emptyField).toBeInTheDocument();
    expect(emptyField).toHaveTextContent('Empty field placeholder');

    const longTextInput = canvas.getByTestId('long-text-input');
    expect(longTextInput).toBeInTheDocument();

    const submitButton = canvas.getByTestId('edge-submit');
    expect(submitButton).toBeInTheDocument();
  },
};

// Test 6: Screen Reader Test
export const ScreenReader: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    children: (
      <>
        <FormField name="accessible" label="Accessible Field" required>
          <TextField
            placeholder="Accessible input"
            fullWidth
            inputProps={{
              'data-testid': 'accessible-input',
              'aria-label': 'Accessible Field',
              'aria-required': 'true',
            }}
          />
        </FormField>
        <Button variant="contained" type="submit" fullWidth aria-label="Submit form">
          Submit
        </Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const accessibleInput = canvas.getByTestId('accessible-input');
    expect(accessibleInput).toHaveAttribute('aria-label', 'Accessible Field');
    expect(accessibleInput).toHaveAttribute('aria-required', 'true');

    const submitButton = canvas.getByRole('button', { name: 'Submit form' });
    expect(submitButton).toBeInTheDocument();
  },
};

// Test 7: Focus Management Test
export const FocusManagement: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    onFocus: fn(),
    onBlur: fn(),
    children: (
      <>
        <FormField name="focusTest" label="Focus Test Field">
          <TextField
            placeholder="Focus test"
            fullWidth
            inputProps={{ 'data-testid': 'focus-input' }}
            onFocus={fn()}
            onBlur={fn()}
          />
        </FormField>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const focusInput = canvas.getByTestId('focus-input');

    // Test focus
    await userEvent.click(focusInput);
    await waitFor(() => {
      expect(focusInput).toHaveFocus();
    });

    // Test blur
    await userEvent.tab();
    await waitFor(() => {
      expect(focusInput).not.toHaveFocus();
    });
  },
};

// Test 8: Theme Variations Test
export const ThemeVariations: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    children: (
      <>
        <Typography variant="h6" mb={2}>
          Theme Variations
        </Typography>
        <FormField name="themed" label="Themed Field">
          <TextField
            placeholder="Themed input"
            fullWidth
            inputProps={{ 'data-testid': 'themed-input' }}
          />
        </FormField>
      </>
    ),
  },
  parameters: {
    backgrounds: {
      default: 'dark',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const themedInput = canvas.getByTestId('themed-input');
    expect(themedInput).toBeInTheDocument();
  },
};

// Test 9: Performance Test
export const Performance: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'lg',
    spacing: 'sm',
    children: (
      <>
        <Typography variant="h6" mb={2}>
          Performance Test - Many Fields
        </Typography>
        {Array.from({ length: 10 }, (_, i) => (
          <FormField key={i} name={`field${i}`} label={`Field ${i + 1}`}>
            <TextField
              placeholder={`Field ${i + 1}`}
              fullWidth
              inputProps={{ 'data-testid': `field-${i}` }}
            />
          </FormField>
        ))}
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check that all fields are rendered
    for (let i = 0; i < 10; i++) {
      const field = canvas.getByTestId(`field-${i}`);
      expect(field).toBeInTheDocument();
    }
  },
};

// Test 10: TestId Verification for Error Messages
export const ErrorMessageTestIds: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    dataTestId: 'error-form',
    children: (
      <>
        <Typography variant="h6" mb={2}>
          Error Message TestIds
        </Typography>
        <FormField name="email" label="Email" required error="Invalid email address" dataTestId="email-field-with-error">
          <TextField
            type="email"
            placeholder="Enter email"
            fullWidth
            error
            inputProps={{ 'data-testid': 'email-input-error' }}
          />
        </FormField>
        <FormField name="username" label="Username" helperText="Choose a unique username" dataTestId="username-field-with-helper">
          <TextField
            placeholder="Enter username"
            fullWidth
            inputProps={{ 'data-testid': 'username-input-helper' }}
          />
        </FormField>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify form testId
    const form = canvas.getByTestId('error-form');
    expect(form).toBeInTheDocument();

    // Verify error message testId
    const errorField = canvas.getByTestId('email-field-with-error');
    expect(errorField).toBeInTheDocument();

    const errorMessage = canvas.getByTestId('email-field-with-error-message');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent('Invalid email address');

    // Verify helper text testId
    const helperField = canvas.getByTestId('username-field-with-helper');
    expect(helperField).toBeInTheDocument();

    const helperMessage = canvas.getByTestId('username-field-with-helper-message');
    expect(helperMessage).toBeInTheDocument();
    expect(helperMessage).toHaveTextContent('Choose a unique username');
  },
};

// Test 11: Integration Test
export const Integration: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'md',
    spacing: 'md',
    onSubmit: fn(),
    children: (
      <>
        <Typography variant="h6" mb={2}>
          Complete Form Integration
        </Typography>
        <FormField name="username" label="Username" required>
          <TextField
            placeholder="Enter username"
            fullWidth
            inputProps={{ 'data-testid': 'username' }}
          />
        </FormField>
        <FormField name="email" label="Email" required>
          <TextField
            type="email"
            placeholder="Enter email"
            fullWidth
            inputProps={{ 'data-testid': 'email' }}
          />
        </FormField>
        <FormField name="bio" label="Bio">
          <TextField
            multiline
            rows={4}
            placeholder="Tell us about yourself"
            fullWidth
            inputProps={{ 'data-testid': 'bio' }}
          />
        </FormField>
        <Button variant="contained" type="submit" fullWidth data-testid="submit">
          Submit Form
        </Button>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Fill out the form
    const username = canvas.getByTestId('username');
    const email = canvas.getByTestId('email');
    const bio = canvas.getByTestId('bio');
    const submit = canvas.getByTestId('submit');

    await userEvent.type(username, 'testuser');
    await userEvent.type(email, 'test@example.com');
    await userEvent.type(bio, 'This is my bio');

    // Verify values
    await waitFor(() => {
      expect(username).toHaveValue('testuser');
      expect(email).toHaveValue('test@example.com');
      expect(bio).toHaveValue('This is my bio');
    });

    // Submit button should be enabled
    expect(submit).toBeEnabled();
  },
};

/**
 * Test 12: the rendered distance between a label and its control.
 *
 * Every other case in this file reads text or a test id, which is what makes
 * them honest in jsdom as well as in a browser. This one deliberately does not:
 * the defect it guards was two spacings ADDING UP, and a sum is only visible
 * where boxes are actually laid out.
 *
 * `FormLabel` carries a 4px `marginBottom`, and `StyledFormField` used to carry
 * an 8px flex `gap` on top of it — 12px where every other user of `FormLabel`
 * draws 4px, and 8px a row of unasked-for height at the bottom of a form. The assertion is stated as "the wrapper adds nothing to the label's own
 * margin" rather than as a literal 4, so it survives the margin being re-tuned
 * and still fails the moment a second mechanism appears beside it.
 *
 * Nothing here reads a font metric, so it is stable wherever it runs: the
 * distance between the label's bottom edge and the control's top edge is
 * margin plus gap, whatever glyphs the label happens to be drawn with.
 *
 * NOTHING IN CI RUNS THIS YET. `test-storybook` reaches it only through
 * `pnpm --filter @12-apps/ui test:ci`, which no workflow invokes and no turbo
 * task defines; this package's vitest `include` is `src/**` + `*.test.{ts,tsx}`,
 * which `*.test.stories.tsx` does not match. So the executing guard for this
 * defect is `form/__tests__/field-spacing.test.tsx`, and this story is the
 * browser check a human runs — until the Storybook job covers this package.
 */
export const LabelToControlDistance: Story = {
  args: {
    variant: 'vertical',
    maxWidth: 'sm',
    spacing: 'md',
    dataTestId: 'spacing-form',
    children: (
      <>
        <FormField name="street" label="Street address" required dataTestId="street-field">
          <TextField fullWidth defaultValue="" inputProps={{ 'data-testid': 'street-input' }} />
        </FormField>
        <FormField
          name="landmark"
          label="Landmark"
          helperText="What the courier looks for"
          dataTestId="landmark-field"
        >
          <TextField fullWidth defaultValue="" inputProps={{ 'data-testid': 'landmark-input' }} />
        </FormField>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const name of ['street', 'landmark']) {
      const field = canvas.getByTestId(`${name}-field`);
      const label = canvas.getByTestId(`${name}-field-label`);
      // The generated `-control` wrapper, not the `<input>`: a control's own
      // root may carry padding of its own, and this row is about the space
      // OUTSIDE it.
      const control = canvas.getByTestId(`${name}-field-control`);

      const declaredMargin = Number.parseFloat(window.getComputedStyle(label).marginBottom);
      const rendered =
        control.getBoundingClientRect().top - label.getBoundingClientRect().bottom;

      // The label's own margin is the ONLY thing between the two.
      expect(Math.round(rendered)).toBe(Math.round(declaredMargin));
      // And that margin is the package's 4px — theme.spacing(0.5).
      expect(Math.round(declaredMargin)).toBe(4);

      // Belt and braces: no row gap on the wrapper to add to it. A browser
      // reports an undeclared gap as `normal`, and `0px` once one is set to
      // zero; anything with a positive length is the regression.
      const wrapperRowGap = window.getComputedStyle(field).rowGap;
      expect(Number.parseFloat(wrapperRowGap) || 0).toBe(0);
    }

    // The control-to-message distance is the same 4px, drawn from the other
    // side. The two being equal is the rule the row is built on; they disagreed
    // 12 to 4 while the wrapper carried a gap of its own.
    const message = canvas.getByTestId('landmark-field-message');
    const control = message.previousElementSibling as HTMLElement;
    const belowControl =
      message.getBoundingClientRect().top - control.getBoundingClientRect().bottom;
    expect(Math.round(belowControl)).toBe(4);
  },
};
