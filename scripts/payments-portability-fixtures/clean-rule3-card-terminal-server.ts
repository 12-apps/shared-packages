// RULE 3 clean counterpart — linted as packages/card-terminal/src/react/<file>.
// Types from the server halves, and runtime values from the browser-safe link.
import type { TypedBookAnswer } from '../server';
import type { TerminalState } from '../station';
import { readMessage } from '../link';

export const wired = { readMessage };
export type Seen = { answer: TypedBookAnswer; state: TerminalState };
