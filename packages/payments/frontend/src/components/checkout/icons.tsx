/**
 * The checkout's icons, drawn inline through MUI's `SvgIcon` (already a peer).
 *
 * The path data is Material Symbols' — byte-identical to the corresponding
 * `@mui/icons-material` exports the storefront rendered before the move — so
 * the screens keep their exact pixels WITHOUT this package growing an
 * icons-package dependency (the design-system contract is peers `@mui/material`
 * + `@emotion/*` and nothing else; see `ui.tsx`).
 */
import { SvgIcon, type SvgIconProps } from '@mui/material';
import type { JSX } from 'react';

function makeIcon(paths: string[]): (props: SvgIconProps) => JSX.Element {
  return function CheckoutIcon(props: SvgIconProps): JSX.Element {
    return (
      <SvgIcon {...props}>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </SvgIcon>
    );
  };
}

export const ArrowBackIcon = makeIcon([
  'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z',
]);

export const LockOutlinedIcon = makeIcon([
  'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2M9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9zm9 14H6V10h12zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2',
]);

export const ContentCopyIcon = makeIcon([
  'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z',
]);

export const CreditCardIcon = makeIcon([
  'M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2m0 14H4v-6h16zm0-10H4V6h16z',
]);

export const PixIcon = makeIcon([
  'm15.45 16.52-3.01-3.01c-.11-.11-.24-.13-.31-.13s-.2.02-.31.13L8.8 16.53c-.34.34-.87.89-2.64.89l3.71 3.7c1.17 1.17 3.07 1.17 4.24 0l3.72-3.71c-.91 0-1.67-.18-2.38-.89M8.8 7.47l3.02 3.02c.08.08.2.13.31.13s.23-.05.31-.13l2.99-2.99c.71-.74 1.52-.91 2.43-.91l-3.72-3.71c-1.17-1.17-3.07-1.17-4.24 0l-3.71 3.7c1.76 0 2.3.58 2.61.89',
  'm21.11 9.85-2.25-2.26H17.6c-.54 0-1.08.22-1.45.61l-3 3c-.28.28-.65.42-1.02.42-.36 0-.74-.15-1.02-.42L8.09 8.17c-.38-.38-.9-.6-1.45-.6H5.17l-2.29 2.3c-1.17 1.17-1.17 3.07 0 4.24l2.29 2.3h1.48c.54 0 1.06-.22 1.45-.6l3.02-3.02c.28-.28.65-.42 1.02-.42s.74.14 1.02.42l3.01 3.01c.38.38.9.6 1.45.6h1.26l2.25-2.26c1.17-1.18 1.17-3.1-.02-4.29',
]);

export const CheckCircleOutlineIcon = makeIcon([
  'M16.59 7.58 10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8',
]);

export const ErrorOutlineIcon = makeIcon([
  'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8',
]);

export const ScheduleIcon = makeIcon([
  'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8',
  'M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z',
]);

export const PersonOutlineIcon = makeIcon([
  'M12 5.9c1.16 0 2.1.94 2.1 2.1s-.94 2.1-2.1 2.1S9.9 9.16 9.9 8s.94-2.1 2.1-2.1m0 9c2.97 0 6.1 1.46 6.1 2.1v1.1H5.9V17c0-.64 3.13-2.1 6.1-2.1M12 4C9.79 4 8 5.79 8 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 9c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4',
]);
