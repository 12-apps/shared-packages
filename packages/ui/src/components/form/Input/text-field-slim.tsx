'use client';

/**
 * `TextField`, minus the branch nobody in a text field takes.
 *
 * MUI's `TextField` is a small composition — a `FormControl` root, an optional
 * `InputLabel`, one of the three input variants, an optional `FormHelperText` —
 * around one branch: `select`. That branch is worth a fortune. `TextField`
 * imports `Select` unconditionally, and `Select` reaches `Menu`, `MenuList`,
 * `Popover`, `NativeSelect`, `List`, `Modal`, `Paper`, `Portal` and `Grow`. Every
 * one of those ships to anyone who renders one text box.
 *
 * Measured in one adopter's storefront, whose header search box is the eager
 * caller: taking that ONE box off `TextField` is worth 35.8 KiB raw and 13
 * fewer `@mui/material` component modules on the critical path — more than any
 * other single item in that bundle.
 *
 * `Input` has never supported `select`: its props are `InputHTMLAttributes`, so
 * no caller can even pass one. The branch was pure cost.
 *
 * ## This is a TRANSCRIPTION, not a redesign
 *
 * Every routing decision below is `TextField`'s, deliberately, down to which
 * props land on the ROOT rather than on the input — including the one that is
 * arguably wrong (an unrecognised HTML attribute goes to the root `div`, which
 * is why `Input` has to route `aria-label` through `inputProps`). Changing any
 * of that here would be a behaviour change wearing a performance change's
 * clothes. `__tests__/text-field-slim.test.tsx` renders this and the real
 * `TextField` side by side and compares the DOM they produce.
 *
 * What is NOT carried over: the `select` branch, the `slots`/`slotProps` API
 * (unreachable through `InputProps`, which is `InputHTMLAttributes`), and the
 * dev-only warning about `children` that only the select branch could emit.
 */
import FilledInput from '@mui/material/FilledInput/index.js';
import StandardInput from '@mui/material/Input/index.js';
import OutlinedInput from '@mui/material/OutlinedInput/index.js';

import { createTextFieldSlim } from './text-field-slim.factory';
import type { TextFieldSlimComponent } from './text-field-slim.factory';

export type { TextFieldSlimProps } from './text-field-slim.factory';

const VARIANT_COMPONENT = {
  standard: StandardInput,
  filled: FilledInput,
  outlined: OutlinedInput,
} as const;

/**
 * The generic field: any of MUI's three variants, chosen at runtime. A field
 * that only ever renders outlined uses `./outlined` instead, which never
 * imports the other two (FUT-1054).
 */
export const TextFieldSlim: TextFieldSlimComponent = createTextFieldSlim(
  (variant) => VARIANT_COMPONENT[variant],
);
