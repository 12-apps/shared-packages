# Heading Component

A flexible heading component supporting semantic HTML heading levels (h1-h6) and a special display variant. Features gradient text effects, configurable font weights, color theming, and responsive typography scales.

## Props

| Prop       | Type                                                                          | Default     | Description                                                             |
| ---------- | ----------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `level`    | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6' \| 'display'`                   | `'h2'`      | Semantic RANK — the tag and the document outline. 'display' renders as h1. |
| `size`     | `'h1' \| 'h2' \| 'h3' \| 'h4' \| 'h5' \| 'h6' \| 'display'`                   | `level`     | Scale step to DRAW, when it differs from the rank.                      |
| `color`    | `'primary' \| 'secondary' \| 'success' \| 'warning' \| 'danger' \| 'neutral'` | `'neutral'` | Theme color variant                                                     |
| `weight`   | `'light' \| 'normal' \| 'medium' \| 'semibold' \| 'bold'`                     | `'bold'`    | Font weight                                                             |
| `gradient` | `boolean`                                                                     | `false`     | Enable gradient text effect                                             |
| `children` | `React.ReactNode`                                                             | -           | Heading content                                                         |

## Usage Examples

### Basic Usage

```tsx
import { Heading } from '@procurement/ui';

// Basic heading
<Heading level="h1">Main Title</Heading>

// Colored heading
<Heading level="h2" color="primary">Section Title</Heading>

// Custom weight
<Heading level="h3" weight="light">Subtitle</Heading>
```

### Display Variant

```tsx
// Extra large display heading (renders as h1)
<Heading level="display" color="primary" weight="bold">
  Hero Title
</Heading>
```

### Gradient Text

```tsx
// Primary-secondary gradient
<Heading level="h1" color="primary" gradient>
  Gradient Heading
</Heading>

// Success gradient
<Heading level="h2" color="success" gradient>
  Success Message
</Heading>
```

### Responsive Headings

```tsx
<Heading
  level="h1"
  sx={{
    fontSize: { xs: '1.5rem', sm: '2rem', md: '2.5rem' },
    textAlign: { xs: 'center', md: 'left' },
  }}
>
  Responsive Heading
</Heading>
```

## Rank and size are separate

`level` is the RANK — which tag renders and where the heading sits in the
document outline. `size` is the scale step it is DRAWN at, and it defaults to
`level`, so a call that passes only `level` behaves exactly as it always did.

```tsx
// An h1 for a screen reader, drawn at h3 — a dense screen's page title.
<Heading level="h1" size="h3">Visão geral</Heading>
```

Reach for `size` when the two genuinely differ for ONE heading. If the whole
product wants a different scale, set it on the theme instead (below) — that is
the knob for "our headings are smaller", and `size` is the one for "this heading
is".

## Typography Scale

An APPLICATION scale. `display` carries the hero size, so a marketing page asks
for it by name and a product screen is not handed one by default.

- **display**: 3rem (48px) - Line height 1.05, Letter spacing -0.03em
- **h1**: 2rem (32px) - Line height 1.2, Letter spacing -0.02em
- **h2**: 1.75rem (28px) - Line height 1.25, Letter spacing -0.015em
- **h3**: 1.5rem (24px) - Line height 1.3, Letter spacing -0.01em
- **h4**: 1.25rem (20px) - Line height 1.35, Letter spacing -0.005em
- **h5**: 1.125rem (18px) - Line height 1.4
- **h6**: 1rem (16px) - Line height 1.5

### Setting it from the theme

The scale is a theme variable, not a constant in the component. Override any
subset of the steps, and any subset of one step's metrics — what you do not name
keeps the package default, so changing a size does not silently drop the
tracking that made it readable.

```ts
import { createTheme } from '@mui/material/styles';

createTheme({
  typography: {
    headingScale: {
      h1: { fontSize: 'clamp(1.75rem, 1.5rem + 0.8vw, 2.125rem)' },
      h2: { fontSize: 'clamp(1.25rem, 1.1rem + 0.4vw, 1.5rem)' },
    },
  },
});
```

It is our own `headingScale` key rather than MUI's `typography.h1…h6`: those are
spoken for by `<Typography>` and ship MUI's own values (`h1` is 6rem), so reading
them would hand an un-themed host a 96px h1 and make `Heading` and `Typography`
impossible to size apart.

The default and its types are exported for anyone who needs to read or extend
them:

```ts
import { HEADING_SCALE, HEADING_LEVELS, type HeadingLevel } from '@12-apps/ui/tokens';
```

## Font Weight Mapping

- **light**: 300
- **normal**: 400
- **medium**: 500
- **semibold**: 600
- **bold**: 700

### Level-Specific Default Weights

- h1, h2: Bold (700) when weight="normal"
- h3, h4, h5, h6: Semibold (600) when weight="normal"
- display: Extra bold (800) when weight="normal"

## Color Theming

All colors are sourced from the MUI theme:

- **primary**: `theme.palette.primary.main`
- **secondary**: `theme.palette.secondary.main`
- **success**: `theme.palette.success.main`
- **warning**: `theme.palette.warning.main`
- **danger**: `theme.palette.error.main`
- **neutral**: `theme.palette.text.primary`

## Gradient Effects

Gradient text uses CSS `background-clip: text` with fallback support:

- **Primary**: Linear gradient from primary to secondary colors
- **Secondary**: Linear gradient from secondary to primary colors
- **Success**: Linear gradient from success.light to success.dark
- **Warning**: Linear gradient from warning.light to warning.dark
- **Danger**: Linear gradient from error.light to error.dark
- **Default**: Primary to secondary gradient

## Accessibility

- Maintains proper semantic heading hierarchy
- Supports all HTML heading attributes (`id`, `aria-label`, etc.)
- Screen reader compatible
- Keyboard focusable when `tabIndex` is set
- WCAG compliant color contrast ratios

## Best Practices

1. **Semantic Hierarchy**: Use heading levels semantically (h1 for main title, h2 for sections, etc.)
2. **Skip Levels**: Avoid skipping heading levels (don't jump from h1 to h3)
3. **Display Variant**: Use `level="display"` only for hero/marketing content, not document structure
4. **Gradient Sparingly**: Use gradient text for emphasis, not body content
5. **Color Contrast**: Ensure sufficient contrast ratios when using custom colors
6. **Responsive Design**: Consider font size scaling on mobile devices

## Browser Support

- **Gradient Text**: Modern browsers with webkit/moz prefixes
- **Typography**: All modern browsers
- **Semantic HTML**: Universal support

## Performance

- Optimized styled-component with `shouldForwardProp`
- Minimal re-renders through prop filtering
- Efficient gradient calculations
- CSS-in-JS compilation optimizations
