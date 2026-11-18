# ErrorState Component

**Purpose:** Error or warning placeholder with an icon, a message and an optional retry.

```ts
interface ErrorStateProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;            // default 'Retry'
  severity?: 'error' | 'warning'; // default 'error'
  icon?: React.ReactNode;
  iconFrame?: 'disc' | 'none';    // default 'disc'
  className?: string;
  dataTestId?: string;
}
```

**`iconFrame`**

- `disc` (default): the icon sits in an 80px disc of the severity's light shade at 0.9 opacity.
- `none`: the icon is drawn bare and at full opacity. Use it for a mascot or illustration passed
  as `icon`, which the disc would tint and dim. Without an `icon`, `none` changes nothing: the fallback glyph keeps its disc.
  A bare icon takes no severity colour; the caller colours it.

**A11y**

- `role="alert"`, labelled by the title and described by the message.
