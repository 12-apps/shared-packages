# UploadProgress

## Purpose

Where a photo is while it goes up: the stage, a bar and the time left — shown
at the photo itself. It draws the three waits of an upload in the order they
happen:

| stage | what is happening | what it shows |
| --- | --- | --- |
| `preparing` | the browser re-encodes the photo | the stage word, the step ("1 of 3"), the bar, and the time — the total until the bytes are up when a sending rate is known, else the stage's own |
| `sending` | the bytes go up | the stage word, the percentage, the bar, the time left once it can be estimated |
| `saving` | the server cuts its crops | a spinner and the stage word, no number |

A stage whose `fraction` is `null` draws an indeterminate bar and no number.
`progress: null` renders nothing (idle, done or failed — a failure is the
host's to state, with its retry, where the photo is).

## Usage

```tsx
import { UploadProgress } from '@12-apps/ui/feedback/UploadProgress';

const upload = useUpload(config); // @12-apps/storage/react
<UploadProgress progress={upload.progress} copy={HOST_COPY} />;
```

`progress` is typed structurally (`UploadProgressValue`): the shape
`@12-apps/storage/react`'s `useUpload` returns, with no import from storage.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `progress` | `UploadProgressValue \| null` | — | `{ stage, fraction, secondsLeft, step?, totalSecondsLeft? }` |
| `copy` | `UploadProgressCopy` | — | REQUIRED, no default words: `preparing`, `sending`, `saving`, `step(n, of)`, `secondsLeft(n)`, `totalSecondsLeft(n)`, `percent(n)` |
| `size` | `'regular' \| 'compact'` | `'regular'` | `compact` (a 44 px thumbnail): the bar alone; put the time beside it with `useUploadTimeLeft(progress)` |
| `dataTestId` | `string` | `'upload-progress'` | Parts: `-stage`, `-figure`, `-bar`, `-time`, `-spinner` |

## Seconds

Rounded up, never `0` while something runs, and never shown going UP by more
than one second between two renders of a stage — a jumpy estimate reads as
broken. `useUploadTimeLeft(progress)` returns the same steadied number for a
caller's own slot.

## Accessibility

The stage word is a polite live region (`role="status"`) and the only text in
it, so a screen reader hears each stage change once and never every percent.
The bar is a `progressbar` named by the stage, with `aria-valuenow` while it is
determinate. In `compact` the word is visually hidden but still announced.

## Composes

`data-display/Progress` (linear and circular). It draws no bar of its own.
