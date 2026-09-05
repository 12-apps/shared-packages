# Stack

A `Box` that is always a flex container, with an optional divider between
children — MUI's `Stack` on the neutral prop set, so it renders on both the web
and React Native.

```tsx
import { Stack } from '@12-apps/ui/layout/Stack';

<Stack direction="row" gap={2} align="center" divider={<Box width={1} bg="neutral" />}>
  …
</Stack>
```

`direction` defaults to `column` and `gap` to `0`, as MUI's does. Every other
prop is `Box`'s (see `layout/Box`). `divider` is cloned between each adjacent
pair of children and never outside them.

`@12-apps/ui/mui/Stack` remains raw MUI and web-only.
