# LazyImage Component

A high-performance image component with lazy loading, progressive enhancement, and comprehensive error handling.

## Overview

The LazyImage component optimizes image loading performance by:
- Loading images only when they're about to enter the viewport
- Providing multiple loading states (skeleton, spinner, placeholder)
- Handling errors gracefully with fallback options
- Supporting progressive image loading with placeholders
- Offering retry mechanisms for failed loads

## Usage

### Basic Usage

```tsx
import { LazyImage } from '@12-apps/ui';

function App() {
  return (
    <LazyImage
      src="https://example.com/image.jpg"
      alt="Example image"
      width={400}
      height={300}
    />
  );
}
```

### With Placeholder

```tsx
<LazyImage
  src="https://example.com/high-res.jpg"
  placeholder="https://example.com/low-res.jpg"
  alt="Progressive loading example"
  loadingState="placeholder"
  width={800}
  height={600}
/>
```

The placeholder is a loading state, and only `loadingState="placeholder"` draws
it — under `skeleton`, `spinner` or `none` the `placeholder` prop is ignored.

- It shows from mount, lazy or not, until the real image settles: its `load`
  plus `fadeInDuration` (at once when `fadeIn` is off), or its final error once
  any retries are spent.
- It sits in the box's flow and gives the box its size. The real image is drawn
  over it, cropped by `objectFit`, and fades in on top; when the placeholder
  goes, the real image takes the flow. So a placeholder whose shape differs
  from the real image's gives the box its shape until the fade ends.
- A placeholder that fails to load is dropped at once, as if none were set.
- `onLoad` and `onError` are the real image's only: the placeholder's load
  never calls `onLoad`, and its failure never calls `onError`.
- An empty `src` keeps the placeholder up; no empty `<img>` is rendered.

**Give it a width.** With no `width` the placeholder shows at its own size,
which for a low-res placeholder is usually tiny. Set one, or `width="100%"`.

### With Error Fallback

```tsx
<LazyImage
  src="https://example.com/image.jpg"
  fallback="https://example.com/fallback.jpg"
  alt="Image with fallback"
  retryOnError
  maxRetries={3}
/>
```

### Custom Fallback Component

```tsx
import BrokenImageIcon from '@mui/icons-material/BrokenImageIcon';

<LazyImage
  src="https://example.com/image.jpg"
  fallback={
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <BrokenImageIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
      <Typography variant="caption">Image not available</Typography>
    </Box>
  }
  alt="Image with custom fallback"
/>
```

### With Skeleton Loading

```tsx
<LazyImage
  src="https://example.com/image.jpg"
  alt="Skeleton loading example"
  loadingState="skeleton"
  skeletonProps={{
    animation: 'wave',
    intensity: 'high'
  }}
  width={400}
  height={300}
/>
```

### With Spinner Loading

```tsx
<LazyImage
  src="https://example.com/image.jpg"
  alt="Spinner loading example"
  loadingState="spinner"
  spinnerProps={{
    size: 60,
    color: '#1976d2',
    thickness: 5
  }}
/>
```

### Eager Loading (No Lazy Loading)

```tsx
<LazyImage
  src="https://example.com/critical-image.jpg"
  alt="Above the fold image"
  lazy={false}
  fetchPriority="high"
  loading="eager"
/>
```

### With Custom Styles

`sx` here is inline CSS for the `<img>`, not MUI's `sx`, and the image's box
clips anything painted outside the image. So a shadow or a hover goes on a
wrapping element, rounded to match the image:

```tsx
<Box
  sx={{
    display: 'inline-flex',
    borderRadius: (theme) => theme.typography.pxToRem(8),
    boxShadow: 3,
    transition: 'transform 0.3s',
    '&:hover': { transform: 'scale(1.05)' },
  }}
>
  <LazyImage
    src="https://example.com/image.jpg"
    alt="Styled image"
    width={200}
    height={200}
    objectFit="cover"
    borderRadius={8}
  />
</Box>
```

### With Callbacks

```tsx
<LazyImage
  src="https://example.com/image.jpg"
  alt="Image with callbacks"
  onLoadStart={() => console.log('Started loading')}
  onLoad={(event) => console.log('Image loaded', event)}
  onError={(event) => console.log('Image failed to load', event)}
/>
```

## Props

### Core Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | **Required.** Image source URL |
| `alt` | `string` | - | **Required.** Alternative text for accessibility |
| `width` | `number \| string` | - | Image width. A number above 1 is design px; a number above 0 and up to 1 is a fraction of the parent, as in `sx` (`0.5` is `50%`); a string is any CSS length. Unset lets the real image size itself naturally — but the loading skeleton and a `ReactNode` `fallback` borrow the other axis when only it is set (a square), or the theme's field height when neither is (FUT-2805) |
| `height` | `number \| string` | `'auto'` | Image height, read like `width`. A fractional height takes effect only when the parent has a definite height |

> **The placeholder's own default, when only one axis is set (FUT-2805).**
> The loading skeleton and a `ReactNode` `fallback` never leave both their own
> axes unresolved — never the real (loaded) image, which always sizes itself
> naturally from `width`/`height` exactly as documented above.
>
> - A **DEFINITE** set axis (a plain design-px number, or an absolute CSS
>   length string) borrows straight onto the unset one: a square in real
>   px/rem — e.g. `width={120}` alone gives the skeleton `120×120`.
> - A **RELATIVE** set axis cannot be copied onto the other one the same way —
>   a width-percentage and a height-percentage measure against two different
>   boxes, so copying the value would re-create the exact 0-height/0-width
>   collapse this default exists to fix. Instead, the set axis keeps its own
>   value and the box squares up through CSS `aspectRatio: '1 / 1'`, with the
>   other axis left `auto` — e.g. `width="100%"` alone gives the skeleton
>   `width: 100%; height: auto; aspect-ratio: 1 / 1`, a square exactly as wide
>   as its (now non-collapsing) container. A length is RELATIVE when:
>   - it is a fraction in `(0, 1]`, or
>   - it has a `%` **anywhere** in the string — not only a bare trailing `%`,
>     but a `%` nested inside `calc()`/`min()`/`max()`/`clamp()` too (FUT-2869:
>     `width="calc(100% - 8px)"` alone squares, exactly like `width="100%"`
>     alone — a `%` still measures against the containing block no matter what
>     it is wrapped in, and borrowing it onto the other axis still collapses
>     to 0 against an auto-height parent), or
>   - it has a viewport unit (`vw`/`vh`/`vmin`/`vmax`) anywhere in the string
>     (FUT-2869: `width="50vw"` alone squares too — see below for why).
>
>   **Why viewport units square instead of borrow (FUT-2869's Decision).** A
>   viewport unit does not collapse to 0 the way a borrowed `%` does — it
>   resolves against the viewport, not the parent, so a literally-borrowed
>   `height: 50vw` is merely some non-zero length. But it is still wrong: the
>   component's own promise for a single set axis is a SQUARE placeholder, and
>   a viewport length borrowed onto the other axis is a square only when the
>   container happens to be exactly the viewport's own size — the moment it
>   isn't (any padding, sidebar, or max-width layout — the ordinary case),
>   `width: 50vw` next to a borrowed `height: 50vw` is visibly not square.
>   Squaring costs nothing extra (the same `aspectRatio` mechanism `%` already
>   uses) and keeps one rule — "does this length depend on anything outside
>   itself" — for every relative unit, instead of one rule for `%` and a
>   different one for viewport units.
> - With **neither** axis set, both take the theme's field height
>   (`theme.fieldHeight`, through `fieldHeight()`/`rem()` — never a raw px).
> - With **both** set, nothing above applies: the placeholder renders exactly
>   as its own explicit `width`/`height` say, unchanged.

### Loading Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `lazy` | `boolean` | `true` | Enable lazy loading |
| `loadingState` | `'skeleton' \| 'spinner' \| 'placeholder' \| 'none'` | `'skeleton'` | Type of loading indicator. `'placeholder'` shows the `placeholder` image until the real image has faded in over it; set a `width` (or `"100%"`) with it |
| `placeholder` | `string` | - | Low-res image shown while loading, only under `loadingState="placeholder"` (ignored otherwise). See [With Placeholder](#with-placeholder) |
| `rootMargin` | `string` | `'100px'` | Intersection Observer margin |
| `threshold` | `number \| number[]` | `0` | Intersection Observer threshold |

### Error Handling Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fallback` | `string \| ReactNode` | - | Fallback content on error |
| `retryOnError` | `boolean` | `false` | Retry loading on error |
| `maxRetries` | `number` | `3` | Maximum retry attempts |
| `retryDelay` | `number` | `1000` | Delay between retries (ms) |

### Visual Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `objectFit` | `'fill' \| 'contain' \| 'cover' \| 'none' \| 'scale-down'` | `'cover'` | Object fit CSS property |
| `objectPosition` | `string` | `'center'` | Object position CSS property |
| `borderRadius` | `number \| string` | - | Border radius |
| `fadeIn` | `boolean` | `true` | Enable fade-in animation |
| `fadeInDuration` | `number` | `300` | Fade-in duration (ms) |

### Event Props

| Prop | Type | Description |
|------|------|-------------|
| `onLoad` | `(event: SyntheticEvent) => void` | Called when image loads |
| `onError` | `(event: SyntheticEvent) => void` | Called on load error |
| `onLoadStart` | `() => void` | Called when loading starts |

### Performance Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `decoding` | `'async' \| 'sync' \| 'auto'` | `'async'` | Image decoding hint |
| `loading` | `'eager' \| 'lazy'` | - | Native `loading` attribute; independent of `lazy` (which gates the `IntersectionObserver`) |
| `fetchPriority` | `'high' \| 'low' \| 'auto'` | - | Fetch priority hint |

### Customization Props

| Prop | Type | Description |
|------|------|-------------|
| `skeletonProps` | `object` | Props for skeleton loader |
| `spinnerProps` | `object` | Props for spinner loader |
| `sx` | `CSSProperties` | Inline CSS for the `<img>`, not MUI's `sx`. The image's box clips anything painted outside the image, such as a shadow |
| `className` | `string` | CSS class name |
| `data-testid` | `string` | Test ID for testing |

## Best Practices

### 1. Always Provide Alt Text
```tsx
// ✅ Good
<LazyImage src="profile.jpg" alt="User profile picture" />

// ❌ Bad
<LazyImage src="profile.jpg" alt="" />
```

### 2. Specify Dimensions for Layout Stability
```tsx
// ✅ Good - Prevents layout shift
<LazyImage
  src="banner.jpg"
  alt="Banner"
  width={1200}
  height={400}
/>

// ⚠️ Caution - May cause layout shift
<LazyImage src="banner.jpg" alt="Banner" />
```

### 3. Use Appropriate Loading States
```tsx
// For content images
<LazyImage
  src="content.jpg"
  alt="Article image"
  loadingState="skeleton"
/>

// For avatars or small images
<LazyImage
  src="avatar.jpg"
  alt="User avatar"
  loadingState="spinner"
  width={48}
  height={48}
/>

// For hero images with low-res placeholders — give it a width, or the
// placeholder shows at its own, tiny, size
<LazyImage
  src="hero-hd.jpg"
  placeholder="hero-lowres.jpg"
  alt="Hero image"
  width="100%"
  loadingState="placeholder"
/>
```

### 4. Handle Errors Gracefully
```tsx
// Provide meaningful fallbacks
<LazyImage
  src="product.jpg"
  alt="Product image"
  fallback={
    <Box sx={{ p: 2, textAlign: 'center' }}>
      <ImageNotSupportedIcon />
      <Typography>Image unavailable</Typography>
    </Box>
  }
  retryOnError
/>
```

### 5. Optimize Critical Images
```tsx
// Above-the-fold images should load immediately
<LazyImage
  src="logo.png"
  alt="Company logo"
  lazy={false}
  fetchPriority="high"
/>
```

## Accessibility

The LazyImage component follows accessibility best practices:

- **Required alt text**: Ensures all images have descriptive alternative text
- **ARIA attributes**: Supports aria-label, aria-describedby, and role
- **Semantic HTML**: Uses proper img elements with appropriate attributes
- **Loading states**: Provides visual feedback during loading
- **Error handling**: Displays meaningful fallback content

## Performance Considerations

1. **Lazy Loading**: Images load only when needed, reducing initial page load
2. **Intersection Observer**: Efficient viewport detection with configurable margins
3. **Progressive Loading**: Support for placeholder images during load
4. **Retry Logic**: Automatic retry for failed loads, at a fixed `retryDelay` — the delay does NOT grow between attempts
5. **Native Loading**: Leverages browser's native lazy loading when available

## Related Components

- [Avatar](../Avatar/Avatar.md) - For user profile images
- [Skeleton](../../layout/Skeleton/Skeleton.md) - For loading states
- [EmptyState](../EmptyState/EmptyState.md) - For missing content