import OutlinedInput from '@mui/material/OutlinedInput/index.js';

import { createTextFieldSlim } from '../text-field-slim.factory';
import type { TextFieldSlimComponent } from '../text-field-slim.factory';

/**
 * `TextFieldSlim` pinned to MUI's outlined input (FUT-1054). The generic field
 * picks its input from a three-way table at runtime, so a bundler has to keep
 * `FilledInput` and `Input` for every caller; this one imports `OutlinedInput`
 * alone. Every variant it can be asked for renders outlined, which is what the
 * outlined `Input` entry ever asks for.
 */
export const OutlinedTextFieldSlim: TextFieldSlimComponent = createTextFieldSlim(() => OutlinedInput);
