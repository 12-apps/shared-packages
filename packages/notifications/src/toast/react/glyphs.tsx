/**
 * The five glyphs a toast draws, as inline paths.
 *
 * Not `@12-apps/ui/icons`: its `Icon` brings the whole glyph table and the
 * native-renderer bridge with it (~15 KiB raw), and a host mounts the toast
 * column on its CRITICAL path — the storefront's entry chunk went over its
 * byte ceiling with it (FUT-3358). The paths are the library's own
 * (`@12-apps/ui/src/icons/paths.generated.ts`, from `@mui/icons-material`), so
 * the glyphs are identical; `SvgIcon` is MUI's, already on every page.
 */
import { type JSX } from 'react';

import { SvgIcon } from '@12-apps/ui/mui/SvgIcon';

const PATHS = {
  CheckCircle: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z'],
  Close: ['M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'],
  ErrorOutline: [
    'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8',
  ],
  Info: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-6h2zm0-8h-2V7h2z'],
  WarningAmber: ['M12 5.99 19.53 19H4.47zM12 2 1 21h22z', 'M13 16h-2v2h2zm0-6h-2v5h2z'],
} as const;

export type ToastGlyphName = keyof typeof PATHS;

/** One glyph, 20px, in `color` (a CSS colour or `inherit`). Decorative: the words say it. */
export function ToastGlyph({ name, color = 'inherit' }: { name: ToastGlyphName; color?: string }): JSX.Element {
  return (
    <SvgIcon aria-hidden="true" sx={{ fontSize: 20, color }}>
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </SvgIcon>
  );
}
