# Alert Component

A beautiful and versatile Alert component with multiple variants, animations, and accessibility features. Supports info, success, warning, danger, glass, and gradient styles with optional glow and pulse effects.

## Features

- Multiple visual variants (info, success, warning, danger, glass, gradient)
- Optional title and description support
- Closable/dismissible alerts with onClose callback
- Custom icon support with default icons per variant
- Glow and pulse animation effects
- Glass morphism design variant
- Gradient backgrounds with shimmer effects
- Full accessibility support with ARIA attributes
- Responsive design that adapts to container width
- Theme integration with MUI design system

## Props

### AlertProps

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'info' \| 'success' \| 'warning' \| 'danger' \| 'glass' \| 'gradient'` | `'info'` | The visual style variant of the alert |
| `color` | `'primary' \| 'secondary' \| 'success' \| 'warning' \| 'danger' \| 'neutral'` | - | Override color for the alert |
| `title` | `string` | - | Alert title text |
| `description` | `string` | - | Alert description text |
| `children` | `ReactNode` | - | Custom content within alert |
| `icon` | `ReactNode` | - | Custom icon for the alert |
| `showIcon` | `boolean` | `true` | Whether to show the default icon |
| `closable` | `boolean` | `false` | Whether the alert can be dismissed |
| `onClose` | `() => void` | - | Callback for dismissible alerts |
| `glow` | `boolean` | `false` | Add a glowing shadow effect |
| `pulse` | `boolean` | `false` | Add a pulsing animation effect |
| `animate` | `boolean` | `true` | Whether to animate the alert on mount |
| `announce` | `'polite' \| 'assertive'` | - | Sets `role` and `aria-live` together — see [Accessibility](#accessibility) |
| `iconPlacement` | `'gutter' \| 'title'` | theme's `uiAlert.iconPlacement`, else `'gutter'` | Icon in its own column, or on the title's line — see [Theming](#theming) |
| `className` | `string` | - | Additional CSS classes |

## Usage Examples

### Basic Alert

```tsx
import { Alert } from '@procurement/ui';

<Alert variant="info">
  This is a basic info alert message.
</Alert>
```

### Alert with Title and Description

```tsx
<Alert 
  variant="success" 
  title="Success!" 
  description="Your action was completed successfully."
/>
```

### Closable Alert

```tsx
<Alert 
  variant="warning" 
  title="Warning" 
  closable
  onClose={() => console.log('Alert closed')}
>
  This alert can be dismissed.
</Alert>
```

### Custom Icon

```tsx
import Star from '@mui/icons-material/Star';

<Alert 
  variant="info" 
  icon={<Star />}
  title="Pro Tip"
>
  You can customize the alert icon.
</Alert>
```

### With Effects

```tsx
<Alert 
  variant="danger" 
  title="Critical Alert" 
  glow
  pulse
>
  This alert has both glow and pulse effects.
</Alert>
```

### Glass Morphism

```tsx
<Alert 
  variant="glass" 
  title="Glass Effect"
  description="This alert uses glassmorphism design with backdrop blur."
/>
```

### With Actions

```tsx
<Alert variant="info" title="System Update">
  <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
    <Button size="small" variant="contained">
      Update Now
    </Button>
    <Button size="small" variant="outlined">
      Later
    </Button>
  </Box>
</Alert>
```

## Variants

- **info**: Blue informational styling with info icon
- **success**: Green success styling with check icon
- **warning**: Orange warning styling with warning icon  
- **danger**: Red error styling with error icon
- **glass**: Glass morphism effect with backdrop blur
- **gradient**: Gradient background with shimmer animation

## Accessibility

The Alert component implements comprehensive accessibility features:

- Uses `role="alert"` for immediate screen reader announcement
- Derives `aria-live` from the variant: **assertive for `danger`, polite for
  every other variant** (`defaultAriaLive`)
- Proper focus management for closable alerts
- Keyboard navigation support (Enter/Space to close)
- High contrast colors meeting WCAG guidelines
- Screen reader compatible content structure

### Hover and press keep the words at 4.5:1

An alert answers a pointer with a flat tint layer (`HOVER.tintAlpha` 0.06,
`ACTIVE.tintAlpha` 0.2, eased back over `ACTIVE.ms`), and nothing moves. That
layer moves the surface toward the mode's absolute — black in light mode, white
in dark — which is the side the ink is on, so on its own it CLOSED the gap the
words are read across: a summary at 4.71:1 idle fell to 3.17:1 pressed in
light mode and 2.68:1 in dark (FUT-4506).

So while the tint is on, the **message** — title, description and whatever
is passed as `children` — steps its ink toward
that same absolute (`POINTER_INK_STEP`; both states' tint and step are
exported as `ALERT_POINTER_STATES` for a theme that asserts its own tones):

| state | toward black (light mode) | toward white (dark mode) |
|---|---|---|
| hover | 0.15 | 0.2 |
| press | 0.35 | 0.6 |

The message holds 4.5:1 at rest, hovered and pressed — the title too, since
16.8px/600 is not WCAG "large" text. The step sits on the title
(`.MuiAlertTitle-root`), the description (`.alert-description`) and the
children (wrapped in `.alert-children` at `display: contents`, so the layout
does not change), each one step. It is a `color-mix()` over `currentColor`:
its amount lands on whatever ink is actually painted, so a theme that repaints
a semantic or `glass` alert's `color` gets the same step on its own ink. It
eases on the tint's clock and lands at once on a press, like the tint.

The icon does not step, in either placement: in the gutter (`.MuiAlert-icon`)
and on the title's row (`iconPlacement: 'title'`), where it sits in the
message column beside the title rather than inside it. The close button
(`.MuiAlert-action`), the focus ring and any control in `children` that
declares its own colour keep their colours and states; a `color="inherit"`
control in `children` steps with the words around it.

`gradient` is not stepped. The step's direction is the mode's, and a host that
repaints a gradient to a light pane with a dark ink would have had that ink
stepped toward white under the variant's black layer. Its rest contrast is
FUT-4516's.

### `announce` — whether the alert interrupts

`role` and `aria-live` are two attributes with one meaning between them, and by
default they disagree. Every alert gets `role="alert"`, whatever its variant,
and `role="alert"` is **implicitly an assertive live region** — so an `info`
alert ships `aria-live="polite"` and an implicitly-assertive role together, and
a reader that honours the role interrupts anyway. The escape is that
`role="status"` is implicitly polite, which is knowledge a call site should not
have to carry.

`announce` carries it:

| `announce` | `role` | `aria-live` |
|---|---|---|
| `'assertive'` | `alert` | `assertive` |
| `'polite'` | `status` | `polite` |
| unset | `alert` | from the variant, as above |

```tsx
// A sentence worth hearing, that is not worth interrupting for.
<Alert variant="info" announce="polite" description="Mais 1 pessoa está nesta mesa agora." showIcon={false} />
```

An explicit `role` or `aria-live` still wins over `announce`, so a call site
that already spells either by hand keeps exactly what it spelled.

## Best Practices

1. Use appropriate variants for message severity
2. Keep alert messages concise and actionable
3. Provide close functionality for non-critical alerts
4. Use custom actions sparingly to avoid overwhelming users
5. Consider animation effects for attention but don't overuse
6. Test with screen readers for accessibility compliance

## Theming

The Alert component integrates with the MUI theme system and responds to:
- Primary/secondary color palette
- Typography variants
- Spacing tokens
- Border radius settings
- Shadow/elevation tokens

### Where the icon sits — `uiAlert.iconPlacement`

A house style, so the host states it ONCE on its theme rather than at each call:

```ts
createTheme({ uiAlert: { iconPlacement: 'title' } });
```

| value | layout |
|---|---|
| `'gutter'` (default) | the icon has a column of its own; title and description start to its right |
| `'title'` | the icon sits on the title's line; the description starts at the alert's edge and uses the whole line |

An alert with no title, or with `showIcon={false}`, has no title line for the
icon, so `'title'` renders as `'gutter'`. A call site that must differ passes
`iconPlacement`, which wins over the theme. Web only.

## Testing

### Test IDs

| Test ID | Element | Description |
|---------|---------|-------------|
| `alert` | Alert container | Main alert wrapper element |
| `alert-icon` | Icon | Alert severity icon |
| `alert-title` | Title | Alert title text |
| `alert-message` | Message | Alert message content |
| `alert-title-row` | Row | Icon and title together (`iconPlacement: 'title'` only) |
| `alert-close` | Button | Close button (when closable) |

Custom test IDs can be provided via the `dataTestId` prop:
```typescript
<Alert dataTestId="custom-alert" />
// Results in: custom-alert, custom-alert-icon, custom-alert-title, etc.
```

### Testing Best Practices

**Wait for Component to Render:**
```typescript
const alert = await canvas.findByTestId('alert');
expect(alert).toBeInTheDocument();
```

**Test Close Interaction:**
```typescript
const closeButton = await canvas.findByTestId('alert-close');
await userEvent.click(closeButton);
expect(onClose).toHaveBeenCalled();
```

**Test Different Severities:**
```typescript
const alert = await canvas.findByTestId('alert');
expect(alert).toHaveAttribute('role', 'alert');
expect(alert).toHaveClass('MuiAlert-standardSuccess');
```

### Common Test Scenarios

1. **Basic Rendering** - Verify alert renders with message
2. **Severity Variants** - Test all severity types (success, error, warning, info)
3. **Closable Alert** - Test close button functionality
4. **With Title** - Verify title renders correctly
5. **Accessibility** - Verify ARIA attributes and role