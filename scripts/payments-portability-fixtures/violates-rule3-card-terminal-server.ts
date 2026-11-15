// RULE 3 violation fixture — linted as packages/card-terminal/src/react/<file>.
//
// The browser half takes runtime values from the server halves, by relative
// path and by subpath name: each drags server code (the station's
// `node:crypto`) into a browser bundle.
import { createCaptureActs } from '../server';
import { ChargeBook } from '../station';
import { readMessage } from '@12-apps/card-terminal/station';

export const wired = { createCaptureActs, ChargeBook, readMessage };
