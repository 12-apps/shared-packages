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

export const ContentCopyIcon = makeIcon([
  'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z',
]);

export const CreditCardIcon = makeIcon([
  'M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2m0 14H4v-6h16zm0-10H4V6h16z',
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

export const CloseIcon = makeIcon([
  'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
]);

export const QrCodeIcon = makeIcon([
  'M3 11h8V3H3zm2-6h4v4H5zM3 21h8v-8H3zm2-6h4v4H5zm8-12v8h8V3zm6 6h-4V5h4zm0 10h2v2h-2zm-6-6h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm0-4h2v2h-2zm2 2h2v2h-2z',
]);

export const CheckIcon = makeIcon(['M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z']);

